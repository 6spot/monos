package host

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func ValidatePublicationRefReadRequest(r protocol.PublicationRefReadRequest) error {
	raw, _, e := wire.Canonical(r)
	if e != nil || len(raw) > 512<<10 || wire.Validate("PublicationRefReadRequest", raw) != nil || r.PushRequestDigest != publicationDigest(r.Push) || validatePublicationPushIdentity(r.Push, false) != nil {
		return errors.New("publication ref read identity mismatch")
	}
	return nil
}

func PublicationRefRead(ctx context.Context, r protocol.PublicationRefReadRequest, access PublicationAccess) (protocol.PublicationRefReadResponse, error) {
	return publicationRefReadAt(ctx, r, filepath.Join(Root, "service", "publication"), publicationRemoteRoot(), publicationRemoteProduction(access))
}

// Reads retain no new effect intent or result. Original worker absence is a
// prerequisite, never an inference from a matching remote ref.
func publicationRefReadAt(ctx context.Context, r protocol.PublicationRefReadRequest, publicationRoot, remoteRoot string, transport publicationRemoteIO) (protocol.PublicationRefReadResponse, error) {
	var response protocol.PublicationRefReadResponse
	if e := ValidatePublicationRefReadRequest(r); e != nil {
		return response, e
	}
	p := r.Push
	item, e := lockPublicationRemoteItem(ctx, remoteRoot, p.ItemID)
	if e != nil {
		return response, e
	}
	defer item.close()
	op := filepath.Join(item.path, "operations", p.OperationID)
	raw, e := readPublicationFile(filepath.Join(op, "intent.json"))
	if e != nil || !bytes.Equal(raw, mustPublicationCanonical(p)) {
		return response, errors.New("publication original intent unavailable")
	}
	var result protocol.PublicationPushResult
	raw, e = readPublicationFile(filepath.Join(op, "result.json"))
	if e != nil || wire.Decode("PublicationPushResult", raw, &result) != nil || verifyPublicationRemoteResult(p, result) != nil || verifyPublicationRemoteAbsence(op, p) != nil {
		return response, errors.New("publication original worker absence unavailable")
	}
	store := publicationStore(publicationRoot, p.Preparation.Source)
	if publicationGitStorage(ctx, store) != nil || verifyPublicationStoreConfiguration(ctx, store) != nil || verifyPublicationManifest(ctx, store, *p.Prepared.Candidate) != nil {
		return response, errors.New("publication original graph unavailable")
	}
	if _, e = verifyPublicationPreparationPages(ctx, publicationRoot, p.Preparation, p.Prepared); e != nil {
		return response, e
	}
	observed, e := observePublicationRemote(ctx, p, store, op, transport)
	if e != nil {
		return response, e
	}
	if ctx.Err() != nil {
		return response, ctx.Err()
	}
	response = protocol.PublicationRefReadResponse{SchemaVersion: 1, Request: r, WorkerAbsent: true, Observation: observed, ObservationDigest: publicationDigest(observed)}
	if wire.Validate("PublicationRefReadResponse", mustPublicationCanonical(response)) != nil {
		return protocol.PublicationRefReadResponse{}, errors.New("publication ref response mismatch")
	}
	return response, nil
}
