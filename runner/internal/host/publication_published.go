package host

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func verifyPublicationProofOriginal(r protocol.PublicationPushRequest, result protocol.PublicationPushResult, p protocol.PublicationPublishedProof) error {
	if verifyPublicationRemoteResult(r, result) != nil || p.OperationID != r.OperationID || p.RequestDigest != publicationDigest(r) || p.ResultDigest != publicationDigest(result) || p.ItemID != r.ItemID || !wire.SameRepositoryProvider(&p.ProviderMetadata, &r.ProviderMetadata) || p.DeliveryRef != r.DeliveryRef || !publicationProofScope(p, r.Preparation.Source) || publicationDigest(p.Candidate) != publicationDigest(r.Prepared.Candidate) || p.CandidateManifestDigest != *r.Prepared.CandidateManifestDigest {
		return errors.New("publication published proof mismatch")
	}
	if result.Status == "published" {
		if p.ObservationDigest != result.ObservationDigest {
			return errors.New("publication published observation mismatch")
		}
	} else if result.Status != "reconciliation_required" || !result.PushStarted {
		return errors.New("publication original effect not published")
	}
	return nil
}

func VerifyPublicationPublished(ctx context.Context, r protocol.PublicationPrepareRequest, access PublicationAccess) error {
	return verifyPublicationPublishedAt(ctx, r, filepath.Join(Root, "service", "publication"), publicationRemoteRoot(), publicationRemoteProduction(access))
}

func verifyPublicationPublishedAt(ctx context.Context, r protocol.PublicationPrepareRequest, publicationRoot, remoteRoot string, transport publicationRemoteIO) error {
	if r.Published == nil || r.PublishedDigest == nil || publicationDigest(*r.Published) != *r.PublishedDigest || !publicationProofScope(*r.Published, r.Source) {
		return errors.New("publication published parent unavailable")
	}
	p := *r.Published
	item, e := lockPublicationRemoteItem(ctx, remoteRoot, p.ItemID)
	if e != nil {
		return e
	}
	defer item.close()
	op := filepath.Join(item.path, "operations", p.OperationID)
	var original protocol.PublicationPushRequest
	raw, e := readPublicationFile(filepath.Join(op, "intent.json"))
	if e != nil || wire.Decode("PublicationPushRequest", raw, &original) != nil || validatePublicationPushIdentity(original, false) != nil {
		return errors.New("publication original intent unavailable")
	}
	var result protocol.PublicationPushResult
	raw, e = readPublicationFile(filepath.Join(op, "result.json"))
	if e != nil || wire.Decode("PublicationPushResult", raw, &result) != nil || verifyPublicationProofOriginal(original, result, p) != nil || verifyPublicationRemoteAbsence(op, original) != nil {
		return errors.New("publication original result unavailable")
	}
	var ack protocol.PublicationPushACK
	raw, e = readPublicationFile(filepath.Join(op, "ack.json"))
	if e != nil || wire.Decode("PublicationPushAck", raw, &ack) != nil || verifyPublicationRemoteACK(original, result, ack) != nil {
		return errors.New("publication original acknowledgement unavailable")
	}
	store := publicationStore(publicationRoot, original.Preparation.Source)
	if publicationGitStorage(ctx, store) != nil || verifyPublicationStoreConfiguration(ctx, store) != nil || verifyPublicationManifest(ctx, store, p.Candidate) != nil {
		return errors.New("publication original graph unavailable")
	}
	if _, e = verifyPublicationPreparationPages(ctx, publicationRoot, original.Preparation, original.Prepared); e != nil {
		return e
	}
	if result.Status == "reconciliation_required" {
		resolution := filepath.Join(op, "resolution.json")
		if raw, e = readPublicationFile(resolution); e == nil {
			if !bytes.Equal(raw, mustPublicationCanonical(p)) {
				return errors.New("publication resolution conflict")
			}
			return nil
		} else if !os.IsNotExist(e) {
			return e
		}
		// An independently authenticated exact read of the ORIGINAL operation
		// resolves uncertainty. The original terminal result and ACK stay immutable.
		observed, e := observePublicationRemote(ctx, original, store, op, transport)
		if e != nil || ctx.Err() != nil || observed.Status != "present" || observed.Head == nil || *observed.Head != p.Candidate.Head {
			return errors.New("publication resolution not independently observed")
		}
		return savePublicationFile(resolution, p)
	}
	return savePublicationFile(filepath.Join(op, "published.json"), p)
}
