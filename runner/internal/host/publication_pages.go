package host

import (
	"encoding/json"
	"errors"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func publicationPages(r protocol.PublicationPrepareRequest, c protocol.PublicationCandidateManifest, coverage publicationCoverage) ([]protocol.PublicationResultPage, error) {
	_, cd, e := wire.Canonical(c)
	if e != nil {
		return nil, e
	}
	findings := []protocol.PublicationFinding{}
	for _, f := range coverage.Findings {
		finding := protocol.PublicationFinding{RuleID: protocol.RuleID(f.Rule), Path: f.Path, PathRedacted: f.PathRedacted, OccurrenceOrdinal: int64(f.Ordinal), Commit: f.Commit, OverrideEligible: f.Eligible, Scope: "publication_commit", Kind: "credential_pattern", Message: "Credential pattern matched; value redacted."}
		if f.Final {
			finding.Scope = "final_tree"
		}
		if f.Blob != "" {
			finding.Blob = &f.Blob
		}
		if f.ContentDigest != "" {
			finding.ContentDigest = &f.ContentDigest
		}
		switch f.Rule {
		case "tracked_ignore":
			finding.Kind = "tracked_ignore"
			finding.Message = "Tracked file matches ignore rules."
		case "policy_blob_size":
			finding.Kind = "publication_policy_size"
			finding.Message = "Blob exceeds local publication policy."
			finding.Size = &f.Size
			finding.Limit = &f.Limit
		case "provider_blob_size":
			finding.Kind = "provider_hard_size"
			finding.Message = "Blob exceeds provider hard limit."
			finding.Size = &f.Size
			finding.Limit = &f.Limit
		case "workflow_permission":
			finding.Kind = "workflow_permission"
			finding.Message = "Workflow write permission is not verified."
		}
		if f.PublishedCommit != "" {
			finding.Kind = "published_credential"
			finding.Message = "Previously published credential exposure requires remediation."
			finding.BaselineCommit = &f.PublishedCommit
			finding.BaselinePath = &f.PublishedPath
			finding.BaselinePathRedacted = &f.BaselinePathRedacted
		}
		raw, _ := json.Marshal(finding)
		var facts map[string]any
		_ = json.Unmarshal(raw, &facts)
		delete(facts, "finding_id")
		_, id, e := wire.Canonical(map[string]any{"candidate_manifest_digest": cd, "configuration_digest": r.ConfigurationDigest, "scan_run_id": r.ScanRunID, "finding_facts_without_id": facts})
		if e != nil {
			return nil, e
		}
		finding.FindingID = id
		encoded, e := json.Marshal(finding)
		if e != nil || wire.Validate("PublicationFinding", encoded) != nil {
			return nil, errors.New("publication finding unavailable")
		}
		findings = append(findings, finding)
	}
	raw, fd, e := wire.Canonical(findings)
	if e != nil {
		return nil, e
	}
	if len(raw) > int(r.Configuration.MaxEvidenceBytes) {
		coverage.Complete = false
		coverage.Reason = "evidence_limit"
		// Preserve bounded sanitized evidence; overflow is explicitly incomplete.
		for len(raw) > int(r.Configuration.MaxEvidenceBytes) && len(findings) > 0 {
			findings = findings[:len(findings)-1]
			raw, fd, e = wire.Canonical(findings)
			if e != nil {
				return nil, e
			}
		}
	}
	summary := protocol.PublicationScanSummary{SchemaVersion: 1, ScanID: r.ScanRunID, CandidateManifestDigest: cd, ConfigurationDigest: r.ConfigurationDigest, Status: "complete", Coverage: protocol.PublicationCoverage{Commits: int64(len(coverage.Commits)), Paths: int64(coverage.Paths), Versions: int64(coverage.Occurrences), UniqueBlobBytes: coverage.UniqueBytes}, FindingsCount: int64(len(findings)), FindingsBytes: int64(len(raw)), FindingsDigest: fd}
	if !coverage.Complete {
		summary.Status = "incomplete"
		reason := coverage.Reason
		switch reason {
		case "occurrence_limit":
			reason = "version_limit"
		case "finding_limit":
			reason = "findings_limit"
		case "interrupted":
			reason = "timeout"
		case "unsupported_mode":
			reason = "unsupported_path"
		case "":
			reason = "missing_object"
		}
		typed := protocol.PublicationScanSummaryReason(reason)
		summary.Reason = &typed
	}
	_, sd, e := wire.Canonical(summary)
	if e != nil {
		return nil, e
	}
	_, rd, e := wire.Canonical(r)
	if e != nil {
		return nil, e
	}
	result := protocol.PublicationResult{SchemaVersion: 1, OperationID: r.OperationID, RequestDigest: rd, Status: "prepared", Candidate: &c, CandidateManifestDigest: &cd, Scan: &summary, ScanDigest: &sd}
	groups := [][]protocol.PublicationFinding{}
	if len(findings) == 0 {
		groups = append(groups, []protocol.PublicationFinding{})
	}
	for at := 0; at < len(findings); {
		group := []protocol.PublicationFinding{}
		for len(group) < 64 && at < len(findings) {
			next := append(append([]protocol.PublicationFinding{}, group...), findings[at])
			_, pd, _ := wire.Canonical(next)
			page := protocol.PublicationResultPage{SchemaVersion: 1, Result: result, PageIndex: 4095, PageCount: 4096, Findings: next, PageDigest: pd}
			raw, _ := json.Marshal(protocol.Frame{SchemaVersion: 1, Type: "publication_result", Incarnation: publicationPointer(int64(9007199254740991)), PublicationResult: &page})
			if len(raw) > 512<<10 {
				if len(group) == 0 {
					return nil, errors.New("publication page limit")
				}
				break
			}
			group = next
			at++
		}
		groups = append(groups, group)
	}
	pages := []protocol.PublicationResultPage{}
	for n, group := range groups {
		_, pd, _ := wire.Canonical(group)
		page := protocol.PublicationResultPage{SchemaVersion: 1, Result: result, PageIndex: int64(n), PageCount: int64(len(groups)), Findings: group, PageDigest: pd}
		raw, _ := json.Marshal(page)
		if wire.Validate("PublicationResultPage", raw) != nil {
			return nil, errors.New("publication page unavailable")
		}
		pages = append(pages, page)
	}
	return pages, nil
}

func publicationPointer[T any](v T) *T { return &v }
