package host

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

type PublicationAccess func(context.Context, protocol.PublicationPushRequest, protocol.PublicationAccessRequestPurpose, string) (protocol.PublicationAccessResult, error)

func publicationAccessSchedulingWait(e error) bool {
	var waiting interface{ PublicationRetryAfter() time.Duration }
	return errors.As(e, &waiting)
}

// These private seams allow actual local Git fixtures; production always uses
// the fixed authenticated Git and canonical HTTPS request, never fixture paths.
type publicationRemoteIO struct {
	access  PublicationAccess
	observe func(context.Context, string, string, protocol.PublicationAccessResult) (publicationRemoteExecution, error)
	push    func(context.Context, string, string, protocol.PublicationAccessResult, publicationPushGuard, func(publicationRemoteWorker) error) (publicationRemoteExecution, error)
	fault   func(string) error
}

func publicationRemoteProduction(access PublicationAccess) publicationRemoteIO {
	return publicationRemoteIO{access: access, observe: func(ctx context.Context, store, op string, a protocol.PublicationAccessResult) (publicationRemoteExecution, error) {
		return runPublicationAuthenticatedGit(ctx, store, op, a, nil, nil)
	}, push: func(ctx context.Context, store, op string, a protocol.PublicationAccessResult, g publicationPushGuard, start func(publicationRemoteWorker) error) (publicationRemoteExecution, error) {
		return runPublicationAuthenticatedGit(ctx, store, op, a, &g, start)
	}}
}
func publicationRemoteRoot() string { return filepath.Join(Root, "service", "remote-preparation") }

func ValidatePublicationPushRequest(r protocol.PublicationPushRequest) error {
	return validatePublicationPushIdentity(r, true)
}
func validatePublicationPushIdentity(r protocol.PublicationPushRequest, requireWorkflow bool) error {
	raw, _, e := wire.Canonical(r)
	if e != nil || len(raw) > 512<<10 || wire.Validate("PublicationPushRequest", raw) != nil || ValidatePublicationRequest(r.Preparation) != nil {
		return errors.New("publication push identity mismatch")
	}
	s := r.Preparation.Source
	if requireWorkflow {
		p := r.Preparation.PermissionProof
		if p == nil || r.Preparation.PermissionProofDigest == nil || r.Preparation.Configuration.WorkflowWrite == "unknown" || p.RepositoryID != r.RepositoryID || p.ConfigurationFingerprint != r.PermissionProof.ConfigurationFingerprint || p.PermissionFingerprint != r.PermissionProof.PermissionFingerprint || p.AppID != r.PermissionProof.AppID || p.InstallationID != r.PermissionProof.InstallationID || p.KeyFingerprint != r.PermissionProof.KeyFingerprint {
			return errors.New("publication scan permission context mismatch")
		}
	}
	c := r.Prepared.Candidate
	if c == nil || r.Prepared.Status != "prepared" || r.Prepared.Scan == nil || r.Prepared.ScanDigest == nil || r.Prepared.CandidateManifestDigest == nil || r.Prepared.OperationID != r.Preparation.OperationID || r.Prepared.RequestDigest != publicationDigest(r.Preparation) || r.PreparationResultDigest != publicationDigest(r.Prepared) || *r.Prepared.CandidateManifestDigest != publicationDigest(*c) || *r.Prepared.ScanDigest != publicationDigest(*r.Prepared.Scan) || r.Prepared.Scan.Status != "complete" || requireWorkflow && r.Prepared.Scan.WorkflowChanges == nil || r.Prepared.Scan.WorkflowChanges != nil && *r.Prepared.Scan.WorkflowChanges != r.WorkflowChanges || r.Prepared.Scan.ScanID != r.Preparation.ScanRunID || r.Prepared.Scan.ConfigurationDigest != r.Preparation.ConfigurationDigest || r.Prepared.Scan.CandidateManifestDigest != *r.Prepared.CandidateManifestDigest || c.SourceDigest != r.Preparation.SourceDigest || c.ConstructionDigest != r.Preparation.ConstructionDigest || c.Tree != s.GitTree || r.TaskID != s.TaskID || r.ResourceID != s.ResourceID || r.RunnerID != s.RunnerID || r.StorageID != s.StorageID || r.RepositoryIdentity != s.RepositoryIdentity || r.RemoteURL != "https://"+s.RepositoryIdentity+".git" || r.TargetBranch != r.Preparation.Construction.TargetBranch || r.DeliveryRef != "refs/heads/monos/task/"+r.TaskID+"/"+r.ResourceID || r.PermissionProofDigest != publicationDigest(r.PermissionProof) || r.PermissionProof.RepositoryID != r.RepositoryID || validatePublicationPermissionFacts(r.PermissionProof, s, r.Preparation.Configuration.PermissionFingerprint) != nil {
		return errors.New("publication push identity mismatch")
	}
	if r.ExpectedHead == nil {
		if r.PriorPublished != nil {
			return errors.New("publication parent mismatch")
		}
	} else {
		if r.PriorPublished == nil || r.PriorPublishedDigest == nil || *r.PriorPublishedDigest != publicationDigest(*r.PriorPublished) || !publicationProofScope(*r.PriorPublished, s) || r.PriorPublished.ItemID != r.ItemID || r.PriorPublished.DeliveryRef != r.DeliveryRef || r.PriorPublished.RepositoryID != r.RepositoryID || r.PriorPublished.Candidate.Head != *r.ExpectedHead || len(c.Parents) == 0 || c.Parents[0] != *r.ExpectedHead {
			return errors.New("publication parent mismatch")
		}
	}
	return nil
}

func PublicationPush(ctx context.Context, r protocol.PublicationPushRequest, access PublicationAccess) (protocol.PublicationPushResult, error) {
	if ValidatePublicationPushRequest(r) != nil {
		return protocol.PublicationPushResult{}, errors.New("publication push identity mismatch")
	}
	dir, status := trustedResultExport(r.Preparation.Source)
	if status != "" || verifyPublicationSource(ctx, dir, r.Preparation.Source) != nil {
		return protocol.PublicationPushResult{}, errors.New("publication source unavailable")
	}
	if r.Preparation.Published != nil {
		if VerifyPublicationPublished(ctx, r.Preparation, access) != nil {
			return protocol.PublicationPushResult{}, errors.New("publication published parent unavailable")
		}
	} else {
		for _, p := range r.Preparation.Construction.Parents {
			if verifyPublicationPin(ctx, p, r.Preparation.Source, r.TargetBranch) != nil {
				return protocol.PublicationPushResult{}, errors.New("publication original pin unavailable")
			}
		}
	}
	root := filepath.Join(Root, "service", "publication")
	store := publicationStore(root, r.Preparation.Source)
	return publicationPushAt(ctx, r, root, store, publicationRemoteRoot(), publicationRemoteProduction(access))
}

func remotePublicationResult(r protocol.PublicationPushRequest, o protocol.PublicationRefObservation, started bool, status, reason string) protocol.PublicationPushResult {
	result := protocol.PublicationPushResult{SchemaVersion: 1, OperationID: r.OperationID, RequestDigest: publicationDigest(r), ItemID: r.ItemID, CandidateManifestDigest: *r.Prepared.CandidateManifestDigest, DeliveryRef: r.DeliveryRef, CandidateHead: r.Prepared.Candidate.Head, PushStarted: started, WorkerAbsent: true, Status: protocol.PublicationPushResultStatus(status), Observation: o, ObservationDigest: publicationDigest(o)}
	if reason != "" {
		result.Reason = publicationPointer(protocol.PublicationRefObservationReason(reason))
	}
	return result
}
func remotePublicationObservation(r protocol.PublicationPushRequest, status, head, reason string) protocol.PublicationRefObservation {
	o := protocol.PublicationRefObservation{SchemaVersion: 1, OperationID: r.OperationID, ItemID: r.ItemID, TaskID: r.TaskID, ResourceID: r.ResourceID, RunnerID: r.RunnerID, StorageID: r.StorageID, RepositoryIdentity: r.RepositoryIdentity, RepositoryID: r.RepositoryID, DeliveryRef: r.DeliveryRef, Status: protocol.PublicationRefObservationStatus(status), ObservedAt: time.Now().UTC().Format("2006-01-02T15:04:05.000Z")}
	if head != "" {
		o.Head = &head
	}
	if reason != "" {
		o.Reason = publicationPointer(protocol.PublicationRefObservationReason(reason))
	}
	o.ObservationID = publicationDigest(o)
	return o
}

func observePublicationRemote(ctx context.Context, r protocol.PublicationPushRequest, store, op string, transport publicationRemoteIO) (protocol.PublicationRefObservation, error) {
	if transport.access == nil {
		return remotePublicationObservation(r, "unavailable", "", "credentials_missing"), nil
	}
	a, e := transport.access(ctx, r, "observe", publicationRandomID())
	if e != nil {
		if publicationAccessSchedulingWait(e) {
			return protocol.PublicationRefObservation{}, e
		}
		return remotePublicationObservation(r, "unavailable", "", "provider_unavailable"), nil
	}
	if validatePublicationAccess(r, a, "observe") != nil {
		return remotePublicationObservation(r, "unavailable", "", "invalid_provider_response"), nil
	}
	out, e := transport.observe(ctx, store, op, a)
	if !out.WorkerAbsent {
		return protocol.PublicationRefObservation{}, errors.New("publication observation worker unresolved")
	}
	if e != nil {
		return remotePublicationObservation(r, "unavailable", "", "provider_unavailable"), nil
	}
	raw := string(out.Output)
	if raw == "" {
		return remotePublicationObservation(r, "absent", "", ""), nil
	}
	if strings.Count(raw, "\n") != 1 || !strings.HasSuffix(raw, "\n") {
		return remotePublicationObservation(r, "unavailable", "", "invalid_provider_response"), nil
	}
	f := strings.Split(strings.TrimSuffix(raw, "\n"), "\t")
	if len(f) != 2 || f[1] != r.DeliveryRef || !objectID.MatchString(f[0]) {
		return remotePublicationObservation(r, "unavailable", "", "invalid_provider_response"), nil
	}
	return remotePublicationObservation(r, "present", f[0], ""), nil
}

func validatePublicationAccess(r protocol.PublicationPushRequest, a protocol.PublicationAccessResult, purpose protocol.PublicationAccessRequestPurpose) error {
	if !validPublicationAuthentication(a) || a.OperationID != r.OperationID || a.RequestDigest != publicationDigest(r) || a.ItemID != r.ItemID || a.Purpose != purpose || a.RemoteURL != r.RemoteURL || a.RepositoryID != r.RepositoryID || a.DeliveryRef != r.DeliveryRef || a.CandidateHead != r.Prepared.Candidate.Head || !equalPublicationHead(a.ExpectedHead, r.ExpectedHead) {
		return errors.New("publication access mismatch")
	}
	if purpose == "push" {
		if a.ClaimID == nil || a.ClaimExpiresAt == nil || a.PermissionProof == nil || a.PermissionProofDigest == nil || *a.PermissionProofDigest != publicationDigest(*a.PermissionProof) || validatePublicationPermissionProof(*a.PermissionProof, r.Preparation.Source, r.PermissionProof.PermissionFingerprint) != nil || a.PermissionProof.ConfigurationFingerprint != r.PermissionProof.ConfigurationFingerprint || a.PermissionProof.AppID != r.PermissionProof.AppID || a.PermissionProof.InstallationID != r.PermissionProof.InstallationID || a.PermissionProof.KeyFingerprint != r.PermissionProof.KeyFingerprint || a.PermissionProof.RepositoryID != r.RepositoryID || r.WorkflowChanges && (a.PermissionProof.Permissions.Workflows == nil || *a.PermissionProof.Permissions.Workflows != "write") {
			return errors.New("publication write permission mismatch")
		}
		exp, e := time.Parse(time.RFC3339Nano, *a.ClaimExpiresAt)
		if e != nil || !exp.After(time.Now().Add(30*time.Second)) {
			return errors.New("publication claim expired")
		}
	}
	return nil
}
func equalPublicationHead(a, b *string) bool {
	return a == nil && b == nil || a != nil && b != nil && *a == *b
}

func publicationPushAt(ctx context.Context, r protocol.PublicationPushRequest, publicationRoot, store, remoteRoot string, transport publicationRemoteIO) (protocol.PublicationPushResult, error) {
	item, e := lockPublicationRemoteItem(ctx, remoteRoot, r.ItemID)
	if e != nil {
		return protocol.PublicationPushResult{}, e
	}
	defer item.close()
	op, e := item.operationDirectory(r.OperationID)
	if e != nil {
		return protocol.PublicationPushResult{}, e
	}
	if e = savePublicationFile(filepath.Join(op, "intent.json"), r); e != nil {
		return protocol.PublicationPushResult{}, e
	}
	if raw, e := readPublicationFile(filepath.Join(op, "result.json")); e == nil {
		var result protocol.PublicationPushResult
		if wire.Decode("PublicationPushResult", raw, &result) != nil || verifyPublicationRemoteResult(r, result) != nil || verifyPublicationRemoteAbsence(op, r) != nil {
			return result, errors.New("publication retained result unavailable")
		}
		return result, nil
	} else if !os.IsNotExist(e) {
		return protocol.PublicationPushResult{}, e
	}
	if publicationRemoteSuccessorGuard(item.path, r.OperationID) != nil {
		return protocol.PublicationPushResult{}, errors.New("publication predecessor unresolved")
	}
	startedRaw, startedErr := readPublicationFile(filepath.Join(op, "started.json"))
	started := startedErr == nil
	if startedErr != nil && !os.IsNotExist(startedErr) {
		return protocol.PublicationPushResult{}, startedErr
	}
	if started {
		if !bytes.Equal(startedRaw, mustPublicationCanonical(map[string]any{"operation_id": r.OperationID, "request_digest": publicationDigest(r)})) {
			return protocol.PublicationPushResult{}, errors.New("publication started intent mismatch")
		}
		if verifyPublicationRemoteAbsence(op, r) != nil {
			if !recoverPublicationRemoteAbsence(op, r) {
				return protocol.PublicationPushResult{}, errors.New("publication physical ownership unresolved")
			}
		}
	}
	settle := func(o protocol.PublicationRefObservation, status, reason string) (protocol.PublicationPushResult, error) {
		if ctx.Err() != nil {
			return protocol.PublicationPushResult{}, ctx.Err()
		}
		result := remotePublicationResult(r, o, started, status, reason)
		if !started {
			if e := savePublicationRemoteAbsence(op, r, false); e != nil {
				return result, e
			}
		}
		if verifyPublicationRemoteAbsence(op, r) != nil {
			return result, errors.New("publication physical ownership unresolved")
		}
		if wire.Validate("PublicationPushResult", mustPublicationCanonical(result)) != nil {
			return result, errors.New("publication result mismatch")
		}
		return result, savePublicationFile(filepath.Join(op, "result.json"), result)
	}
	if started {
		o, e := observePublicationRemote(ctx, r, store, op, transport)
		if e != nil {
			return protocol.PublicationPushResult{}, e
		}
		if ctx.Err() != nil {
			return protocol.PublicationPushResult{}, ctx.Err()
		}
		if o.Head != nil && *o.Head == r.Prepared.Candidate.Head {
			return settle(o, "published", "")
		}
		return settle(o, "reconciliation_required", "possible_publication")
	}
	findings, e := verifyPublicationPreparationPages(ctx, publicationRoot, r.Preparation, r.Prepared)
	if e != nil || publicationGitStorage(ctx, store) != nil || verifyPublicationManifest(ctx, store, *r.Prepared.Candidate) != nil {
		return settle(remotePublicationObservation(r, "unavailable", "", "retained_unavailable"), "blocked", "retained_unavailable")
	}
	if !physicalPublicationScanMatches(ctx, store, r, findings) {
		if ctx.Err() != nil {
			return protocol.PublicationPushResult{}, ctx.Err()
		}
		return settle(remotePublicationObservation(r, "unavailable", "", "scan_incomplete"), "blocked", "scan_incomplete")
	}
	if !publicationFindingsAuthorized(r, findings) {
		return settle(remotePublicationObservation(r, "unavailable", "", "findings_blocked"), "blocked", "findings_blocked")
	}
	o, e := observePublicationRemote(ctx, r, store, op, transport)
	if e != nil {
		return protocol.PublicationPushResult{}, e
	}
	if ctx.Err() != nil {
		return protocol.PublicationPushResult{}, ctx.Err()
	}
	if o.Head != nil && *o.Head == r.Prepared.Candidate.Head {
		return settle(o, "published", "")
	}
	if o.Status == "unavailable" {
		return settle(o, "blocked", string(*o.Reason))
	}
	if !equalPublicationHead(o.Head, r.ExpectedHead) {
		return settle(o, "blocked", "unexpected_head")
	}
	a, e := transport.access(ctx, r, "push", publicationRandomID())
	if publicationAccessSchedulingWait(e) {
		return protocol.PublicationPushResult{}, e
	}
	if e != nil || validatePublicationAccess(r, a, "push") != nil {
		return settle(remotePublicationObservation(r, "unavailable", "", "access_denied"), "blocked", "access_denied")
	}
	if ctx.Err() != nil {
		return protocol.PublicationPushResult{}, ctx.Err()
	}
	// Permission I/O never grants construction authority: recheck immutable tree,
	// manifest and scan bytes immediately before retaining the possible effect.
	if !physicalPublicationScanMatches(ctx, store, r, findings) {
		return protocol.PublicationPushResult{}, errors.New("publication final scan unavailable")
	}
	if validatePublicationAccess(r, a, "push") != nil || ctx.Err() != nil {
		return protocol.PublicationPushResult{}, errors.New("publication grant expired before effect")
	}
	if e = savePublicationFile(filepath.Join(op, "started.json"), map[string]any{"operation_id": r.OperationID, "request_digest": publicationDigest(r)}); e != nil {
		return protocol.PublicationPushResult{}, e
	}
	started = true
	if transport.fault != nil {
		if e = transport.fault("started"); e != nil {
			return protocol.PublicationPushResult{}, e
		}
	}
	expected := strings.Repeat("0", len(r.Prepared.Candidate.Head))
	if r.ExpectedHead != nil {
		expected = *r.ExpectedHead
	}
	g := publicationPushGuard{r.Prepared.Candidate.Head, expected, r.DeliveryRef, r.RemoteURL}
	out, pushErr := transport.push(ctx, store, op, a, g, func(worker publicationRemoteWorker) error {
		if e := savePublicationFile(filepath.Join(op, "worker.json"), worker); e != nil {
			return e
		}
		if transport.fault != nil {
			return transport.fault("worker")
		}
		return nil
	})
	if !out.WorkerAbsent {
		return protocol.PublicationPushResult{}, errors.New("publication physical ownership unresolved")
	}
	if e = savePublicationRemoteAbsence(op, r, true); e != nil {
		return protocol.PublicationPushResult{}, e
	}
	if ctx.Err() != nil {
		return protocol.PublicationPushResult{}, ctx.Err()
	}
	if transport.fault != nil {
		if e = transport.fault("effect"); e != nil {
			return protocol.PublicationPushResult{}, e
		}
	}
	o, e = observePublicationRemote(ctx, r, store, op, transport)
	if e != nil {
		return protocol.PublicationPushResult{}, e
	}
	if ctx.Err() != nil {
		return protocol.PublicationPushResult{}, ctx.Err()
	}
	if o.Head != nil && *o.Head == r.Prepared.Candidate.Head {
		return settle(o, "published", "")
	}
	_ = pushErr // Raw Git failure never proves remote nonexecution or enters result.
	return settle(o, "reconciliation_required", "possible_publication")
}

func savePublicationRemoteAbsence(op string, r protocol.PublicationPushRequest, started bool) error {
	record := map[string]any{"request_digest": publicationDigest(r), "worker_absent": true, "started": started}
	if started {
		raw, e := readPublicationFile(filepath.Join(op, "worker.json"))
		if e != nil {
			return e
		}
		var worker publicationRemoteWorker
		if json.Unmarshal(raw, &worker) != nil || worker.PID <= 1 || worker.Group != worker.PID || worker.UID != uint32(os.Geteuid()) || runtime.GOOS == "linux" && (worker.Birth == "" || worker.BootID == "") {
			return errors.New("publication worker identity unavailable")
		}
		record["worker_digest"] = publicationDigest(worker)
	}
	return savePublicationFile(filepath.Join(op, "absence.json"), record)
}

func verifyPublicationRemoteAbsence(op string, r protocol.PublicationPushRequest) error {
	raw, e := readPublicationFile(filepath.Join(op, "absence.json"))
	if e != nil {
		return e
	}
	var record struct {
		RequestDigest string `json:"request_digest"`
		WorkerAbsent  bool   `json:"worker_absent"`
		Started       bool   `json:"started"`
		WorkerDigest  string `json:"worker_digest"`
	}
	if json.Unmarshal(raw, &record) != nil || record.RequestDigest != publicationDigest(r) || !record.WorkerAbsent {
		return errors.New("publication physical ownership unresolved")
	}
	_, e = readPublicationFile(filepath.Join(op, "started.json"))
	if (e == nil) != record.Started || e != nil && !os.IsNotExist(e) {
		return errors.New("publication started identity mismatch")
	}
	if record.Started {
		raw, e := readPublicationFile(filepath.Join(op, "worker.json"))
		if e != nil {
			return e
		}
		var worker publicationRemoteWorker
		if json.Unmarshal(raw, &worker) != nil || record.WorkerDigest != publicationDigest(worker) || worker.PID <= 1 || worker.Group != worker.PID || worker.UID != uint32(os.Geteuid()) || runtime.GOOS == "linux" && (worker.Birth == "" || worker.BootID == "") {
			return errors.New("publication worker identity unavailable")
		}
	}
	return nil
}

// Restart signals require unchanged boot/birth/actual UID. A dead leader with a
// live group, missing spawn record, or reused identity stays unresolved.
func recoverPublicationRemoteAbsence(op string, r protocol.PublicationPushRequest) bool {
	raw, e := readPublicationFile(filepath.Join(op, "worker.json"))
	if e != nil {
		return false
	}
	var worker publicationRemoteWorker
	if json.Unmarshal(raw, &worker) != nil || worker.PID <= 1 || worker.Group != worker.PID || worker.UID != uint32(os.Geteuid()) || worker.Birth == "" || worker.BootID == "" || runtime.GOOS != "linux" {
		return false
	}
	boot, e := BootID()
	if e != nil {
		return false
	}
	absent := boot != worker.BootID
	if !absent {
		probe := syscall.Kill(-worker.Group, 0)
		if probe == syscall.ESRCH {
			absent = true
		} else if probe == nil {
			identity, e := Identity(worker.PID)
			uid, ue := publicationRemoteProcUID(worker.PID)
			group, ge := syscall.Getpgid(worker.PID)
			second, se := Identity(worker.PID)
			if e != nil || ue != nil || ge != nil || se != nil || identity != second || group != worker.Group || identity.BootID != worker.BootID || identity.Birth != worker.Birth || uid != worker.UID {
				return false
			}
			absent, _ = settlePublicationRemoteGroup(worker.Group)
		}
	}
	return absent && savePublicationRemoteAbsence(op, r, true) == nil
}
