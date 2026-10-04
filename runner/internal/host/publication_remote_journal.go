package host

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func publicationRandomID() string {
	var raw [16]byte
	if _, e := rand.Read(raw[:]); e != nil {
		return ""
	}
	return hex.EncodeToString(raw[:])
}

func physicalPublicationScanMatches(ctx context.Context, store string, r protocol.PublicationPushRequest, findings []protocol.PublicationFinding) bool {
	if verifyPublicationStoreConfiguration(ctx, store) != nil || verifyPublicationManifest(ctx, store, *r.Prepared.Candidate) != nil {
		return false
	}
	c := r.Preparation.Configuration
	l := publicationLimits{int(c.MaxCommits), int(c.MaxPaths), int(c.MaxVersions), int(c.MaxFindings), int(c.MaxEvidenceBytes), c.MaxBlobBytes, c.MaxAggregateBytes, c.LocalBlobLimit, c.ProviderBlobLimit}
	scan := scanPublication(ctx, store, r.Prepared.Candidate.Head, r.Prepared.Candidate.Parents, string(c.WorkflowWrite), l)
	if !scan.Complete || scan.WorkflowChanges != r.WorkflowChanges {
		return false
	}
	pages, e := publicationPages(r.Preparation, *r.Prepared.Candidate, scan)
	if e != nil || len(pages) == 0 || publicationDigest(pages[0].Result.Scan) != publicationDigest(r.Prepared.Scan) {
		return false
	}
	actual := []protocol.PublicationFinding{}
	for _, p := range pages {
		actual = append(actual, p.Findings...)
	}
	return publicationDigest(actual) == publicationDigest(findings)
}

func publicationFindingsAuthorized(r protocol.PublicationPushRequest, findings []protocol.PublicationFinding) bool {
	covered := map[string]bool{}
	for _, receipt := range r.OverrideReceipts {
		s := receipt.Selection
		if s.CandidateID != r.Prepared.Candidate.CandidateID || s.CandidateManifestDigest != *r.Prepared.CandidateManifestDigest || s.EffectiveBasisDigest != r.Preparation.EffectiveBasisDigest || s.ScanDigest != *r.Prepared.ScanDigest || s.MappingDigest != nil || receipt.SelectionDigest != publicationDigest(s) || !sort.StringsAreSorted(s.FindingIDS) {
			return false
		}
		for _, id := range s.FindingIDS {
			if covered[id] {
				return false
			}
			covered[id] = true
		}
	}
	for _, f := range findings {
		if !f.OverrideEligible || !covered[f.FindingID] {
			return false
		}
		delete(covered, f.FindingID)
	}
	return len(covered) == 0
}

func verifyPublicationRemoteResult(r protocol.PublicationPushRequest, result protocol.PublicationPushResult) error {
	o := result.Observation
	if result.OperationID != r.OperationID || result.RequestDigest != publicationDigest(r) || result.ItemID != r.ItemID || result.CandidateHead != r.Prepared.Candidate.Head || result.CandidateManifestDigest != *r.Prepared.CandidateManifestDigest || result.DeliveryRef != r.DeliveryRef || !result.WorkerAbsent || result.ObservationDigest != publicationDigest(o) || o.OperationID != r.OperationID || o.ItemID != r.ItemID || o.TaskID != r.TaskID || o.ResourceID != r.ResourceID || o.RunnerID != r.RunnerID || o.StorageID != r.StorageID || o.RepositoryIdentity != r.RepositoryIdentity || o.RepositoryID != r.RepositoryID || o.DeliveryRef != r.DeliveryRef || result.Status == "published" && (o.Head == nil || *o.Head != result.CandidateHead) {
		return errors.New("publication remote result mismatch")
	}
	return nil
}

func publicationRemoteSuccessorGuard(item, operation string) error {
	dir := filepath.Join(item, "operations")
	entries, e := os.ReadDir(dir)
	if os.IsNotExist(e) {
		return nil
	}
	if e != nil || len(entries) > 4096 {
		return errors.New("publication predecessor unavailable")
	}
	for _, entry := range entries {
		if !entry.IsDir() || entry.Name() == operation {
			continue
		}
		op := filepath.Join(dir, entry.Name())
		var r protocol.PublicationPushRequest
		raw, e := readPublicationFile(filepath.Join(op, "intent.json"))
		if e != nil || wire.Decode("PublicationPushRequest", raw, &r) != nil {
			return errors.New("publication predecessor unavailable")
		}
		var result protocol.PublicationPushResult
		raw, e = readPublicationFile(filepath.Join(op, "result.json"))
		if e != nil || wire.Decode("PublicationPushResult", raw, &result) != nil || verifyPublicationRemoteResult(r, result) != nil || verifyPublicationRemoteAbsence(op, r) != nil {
			return errors.New("publication predecessor unresolved")
		}
		var ack protocol.PublicationPushACK
		raw, e = readPublicationFile(filepath.Join(op, "ack.json"))
		if e != nil || json.Unmarshal(raw, &ack) != nil || verifyPublicationRemoteACK(r, result, ack) != nil {
			return errors.New("publication predecessor acknowledgement missing")
		}
		if result.Status == "reconciliation_required" {
			raw, e = readPublicationFile(filepath.Join(op, "resolution.json"))
			if e != nil {
				return errors.New("publication predecessor unresolved")
			}
			var proof protocol.PublicationPublishedProof
			if wire.Decode("PublicationPublishedProof", raw, &proof) != nil || verifyPublicationProofOriginal(r, result, proof) != nil {
				return errors.New("publication predecessor resolution mismatch")
			}
		}
	}
	return nil
}

func verifyPublicationRemoteACK(r protocol.PublicationPushRequest, result protocol.PublicationPushResult, ack protocol.PublicationPushACK) error {
	if ack.OperationID != r.OperationID || ack.RequestDigest != publicationDigest(r) || ack.ItemID != r.ItemID || ack.ResultDigest != publicationDigest(result) {
		return errors.New("publication push acknowledgement mismatch")
	}
	return nil
}

func PublicationPushAck(ctx context.Context, ack protocol.PublicationPushACK) error {
	return publicationPushAckAt(ctx, publicationRemoteRoot(), ack)
}
func publicationPushAckAt(ctx context.Context, root string, ack protocol.PublicationPushACK) error {
	if ctx.Err() != nil {
		return ctx.Err()
	}
	if !ValidID(ack.ItemID) || !ValidID(ack.OperationID) {
		return errors.New("publication acknowledgement identity unavailable")
	}
	op := filepath.Join(root, "items", ack.ItemID, "operations", ack.OperationID)
	if resultParents(op, uint32(os.Geteuid())) != nil || serviceDirectory(op, true) != nil {
		return errors.New("publication acknowledgement storage unavailable")
	}
	// ACK only appends knowledge beside already immutable result/absence records.
	// It must not wait behind an effect worker or disappear when its queue is full.

	var r protocol.PublicationPushRequest
	raw, e := readPublicationFile(filepath.Join(op, "intent.json"))
	if e != nil || wire.Decode("PublicationPushRequest", raw, &r) != nil {
		return errors.New("publication intent unavailable")
	}
	var result protocol.PublicationPushResult
	raw, e = readPublicationFile(filepath.Join(op, "result.json"))
	if e != nil || wire.Decode("PublicationPushResult", raw, &result) != nil || verifyPublicationRemoteResult(r, result) != nil || verifyPublicationRemoteACK(r, result, ack) != nil || verifyPublicationRemoteAbsence(op, r) != nil {
		return errors.New("publication acknowledgement unavailable")
	}
	return savePublicationFile(filepath.Join(op, "ack.json"), ack)
}

func ReplayPublicationPushResults(ctx context.Context, emit func(protocol.PublicationPushResult) error) error {
	root := filepath.Join(publicationRemoteRoot(), "items")
	items, e := os.ReadDir(root)
	if os.IsNotExist(e) {
		return nil
	}
	if e != nil || len(items) > 4096 {
		return errors.New("publication replay unavailable")
	}
	for _, item := range items {
		if !item.IsDir() || !ValidID(item.Name()) {
			return errors.New("publication replay unavailable")
		}
		lock, e := lockPublicationRemoteItem(ctx, publicationRemoteRoot(), item.Name())
		if e != nil {
			return e
		}
		e = func() error {
			defer lock.close()
			ops, e := os.ReadDir(filepath.Join(lock.path, "operations"))
			if os.IsNotExist(e) {
				return nil
			}
			if e != nil || len(ops) > 4096 {
				return errors.New("publication replay unavailable")
			}
			for _, operation := range ops {
				if ctx.Err() != nil {
					return ctx.Err()
				}
				if !operation.IsDir() || !ValidID(operation.Name()) {
					return errors.New("publication replay unavailable")
				}
				op := filepath.Join(lock.path, "operations", operation.Name())
				var r protocol.PublicationPushRequest
				raw, e := readPublicationFile(filepath.Join(op, "intent.json"))
				if e != nil || wire.Decode("PublicationPushRequest", raw, &r) != nil {
					return errors.New("publication replay intent unavailable")
				}
				raw, e = readPublicationFile(filepath.Join(op, "result.json"))
				if os.IsNotExist(e) {
					continue
				}
				var result protocol.PublicationPushResult
				if e != nil || wire.Decode("PublicationPushResult", raw, &result) != nil || verifyPublicationRemoteResult(r, result) != nil || verifyPublicationRemoteAbsence(op, r) != nil {
					return errors.New("publication replay result unavailable")
				}
				if raw, e = readPublicationFile(filepath.Join(op, "ack.json")); e == nil {
					var ack protocol.PublicationPushACK
					if json.Unmarshal(raw, &ack) != nil || verifyPublicationRemoteACK(r, result, ack) != nil {
						return errors.New("publication replay ack mismatch")
					}
					continue
				} else if !os.IsNotExist(e) {
					return e
				}
				if e = emit(result); e != nil {
					return e
				}
			}
			return nil
		}()
		if e != nil {
			return e
		}
	}
	return nil
}
