package host

import (
	"context"
	"encoding/json"
	"errors"
	"path/filepath"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func preparePublicationMappingAt(ctx context.Context, r protocol.PublicationPrepareRequest, dir, opDir string) ([]protocol.PublicationResultPage, error) {
	p := r.Published
	if p == nil || r.PublishedDigest == nil || publicationDigest(*p) != *r.PublishedDigest || !publicationProofScope(*p, r.Source) || verifyPublicationManifest(ctx, dir, p.Candidate) != nil {
		return PublicationFailure(r, "reconciliation_required", "unverified_parent"), nil
	}
	config := r.Configuration
	limits := publicationLimits{int(config.MaxCommits), int(config.MaxPaths), int(config.MaxVersions), int(config.MaxFindings), int(config.MaxEvidenceBytes), config.MaxBlobBytes, config.MaxAggregateBytes, config.LocalBlobLimit, config.ProviderBlobLimit}
	scan := scanPublication(ctx, dir, p.Candidate.Head, []string{p.Candidate.Head}, string(config.WorkflowWrite), limits)
	if errors.Is(ctx.Err(), context.DeadlineExceeded) {
		scan.Complete = false
		scan.Reason = "interrupted"
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return nil, ctx.Err()
	}
	pages, e := publicationPages(r, p.Candidate, scan)
	if e != nil {
		return nil, e
	}
	mapping := protocol.PublishedResultMapping{SchemaVersion: 1, MappingID: r.OperationID, OperationID: r.OperationID, RequestDigest: publicationDigest(r), ItemID: p.ItemID, Source: r.Source, SourceDigest: r.SourceDigest, EffectiveBasis: r.EffectiveBasis, EffectiveBasisDigest: r.EffectiveBasisDigest, Published: *p, PublishedDigest: *r.PublishedDigest, CandidateManifestDigest: p.CandidateManifestDigest, ReusedHead: p.Candidate.Head, ResultTree: r.Source.GitTree, ConfigurationDigest: r.ConfigurationDigest}
	md := publicationDigest(mapping)
	for i := range pages {
		pages[i].Result.Status = "mapped"
		pages[i].Result.Mapping = &mapping
		pages[i].Result.MappingDigest = &md
		raw, e := json.Marshal(protocol.Frame{SchemaVersion: 1, Type: "publication_result", Incarnation: publicationPointer(int64(9007199254740991)), PublicationResult: &pages[i]})
		if e != nil || len(raw) > 512<<10 || wire.Validate("Frame", raw) != nil {
			return nil, errors.New("publication mapping page unavailable")
		}
	}
	if e = savePublicationFile(filepath.Join(opDir, "pages.json"), pages); e != nil {
		return nil, e
	}
	return pages, nil
}
