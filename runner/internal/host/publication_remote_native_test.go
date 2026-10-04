package host

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	protocol "monos.local/protocol"
)

const publicationKernelRepository = "6spot/monolab-feasibility-20260928-160020-public"
const publicationKernelRepositoryID = "1393178791"

var publicationKernelUUID = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)

// Explicit opt-in native lower-kernel bridge. This request is not a formal
// PublicationPushRequest or an original workspace-open proof. Its separate
// fixture scope prevents OAuth injection from being labeled App issuance.
type publicationKernelInput struct {
	Action              string  `json:"action"`
	Repository          string  `json:"repository"`
	RepositoryID        string  `json:"repository_id"`
	TaskID              string  `json:"task_id"`
	ResourceID          string  `json:"resource_id"`
	ItemID              string  `json:"item_id"`
	OperationID         string  `json:"operation_id"`
	PreviousOperationID string  `json:"previous_operation_id,omitempty"`
	Base                string  `json:"base"`
	ExpectedHead        *string `json:"expected_head"`
	SyntheticText       string  `json:"synthetic_text,omitempty"`
}

func TestRemotePreparationGitHubKernelFixture(t *testing.T) {
	root := os.Getenv("MONOS_REMOTE_GITHUB_EVIDENCE_DIR")
	if root == "" {
		t.Skip("explicit authorized native GitHub kernel bridge")
	}
	if !filepath.IsAbs(root) || publicationDirectory(root) != nil {
		t.Fatal("safe private native evidence directory required")
	}
	raw, e := io.ReadAll(io.LimitReader(os.Stdin, 16385))
	if e != nil || len(raw) > 16384 {
		t.Fatal("bounded native metadata unavailable")
	}
	var input publicationKernelInput
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&input) != nil || input.Repository != publicationKernelRepository || input.RepositoryID != publicationKernelRepositoryID || !ValidID(input.ItemID) || !ValidID(input.OperationID) || !publicationKernelUUID.MatchString(input.TaskID) || !publicationKernelUUID.MatchString(input.ResourceID) || !objectID.MatchString(input.Base) || input.ExpectedHead != nil && !objectID.MatchString(*input.ExpectedHead) || len(input.SyntheticText) > 4096 || publicationSensitivePath(input.SyntheticText) {
		t.Fatal("native fixture scope rejected")
	}
	var trailing any
	if decoder.Decode(&trailing) != io.EOF {
		t.Fatal("native metadata trailing content rejected")
	}
	if input.Action != "prepare_push" && input.Action != "correction_push" && input.Action != "observe" {
		t.Fatal("native fixture action rejected")
	}
	if strings.ContainsAny(input.SyntheticText, "\x00\r") {
		t.Fatal("native synthetic text rejected")
	}
	// FD3 is supplied by the root harness through an anonymous pipe. Neither
	// metadata stdin nor an environment variable/file contains the token.
	credential := os.NewFile(3, "ephemeral-grant")
	if credential == nil {
		t.Fatal("ephemeral grant FD unavailable")
	}
	tokenRaw, e := io.ReadAll(io.LimitReader(credential, 16385))
	_ = credential.Close()
	if e != nil || len(tokenRaw) > 16384 {
		t.Fatal("bounded ephemeral grant unavailable")
	}
	token := strings.TrimSuffix(string(tokenRaw), "\n")
	tokenRaw = nil
	expires := time.Now().Add(5 * time.Minute).UTC().Format("2006-01-02T15:04:05.000Z")
	access := protocol.PublicationAccessResult{Authentication: protocol.Authentication{Kind: "github_installation", Token: &token, ExpiresAt: &expires}, RemoteURL: "https://github.com/" + publicationKernelRepository + ".git", DeliveryRef: "refs/heads/monos/task/" + input.TaskID + "/" + input.ResourceID}
	if !validPublicationAuthentication(access) {
		t.Fatal("ephemeral grant rejected")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	item, e := lockPublicationRemoteItem(ctx, filepath.Join(root, "remote"), input.ItemID)
	if e != nil {
		t.Fatal(e)
	}
	defer item.close()
	op, e := item.operationDirectory(input.OperationID)
	if e != nil {
		t.Fatal(e)
	}
	store := filepath.Join(root, "public-object-store.git")
	if _, e := os.Lstat(store); os.IsNotExist(e) {
		if publicationDirectory(store) != nil {
			t.Fatal("native private store unavailable")
		}
		if _, e := publicationMutatingGit(ctx, store, nil, nil, "init", "--bare", "--quiet", store); e != nil {
			t.Fatal("native private store initialization failed")
		}
	}
	if publicationGitStorage(ctx, store) != nil || verifyPublicationStoreConfiguration(ctx, store) != nil {
		t.Fatal("native public store unavailable")
	}
	readRef := func(ref string) (string, error) {
		a := access
		a.DeliveryRef = ref
		out, e := runPublicationAuthenticatedGit(ctx, store, op, a, nil, nil)
		if e != nil || !out.WorkerAbsent {
			return "", errors.New("native exact ref unavailable")
		}
		if len(out.Output) == 0 {
			return "", nil
		}
		fields := strings.Split(strings.TrimSuffix(string(out.Output), "\n"), "\t")
		if strings.Count(string(out.Output), "\n") != 1 || len(fields) != 2 || fields[1] != ref || !objectID.MatchString(fields[0]) {
			return "", errors.New("native exact ref malformed")
		}
		return fields[0], nil
	}
	if input.Action == "observe" {
		head, e := readRef(access.DeliveryRef)
		if e != nil {
			t.Fatal("native observation unavailable")
		}
		if savePublicationFile(filepath.Join(op, "observation.json"), map[string]any{"fixture_scope": "oauth_injected_remote_kernel", "repository": input.Repository, "repository_id": input.RepositoryID, "delivery_ref": access.DeliveryRef, "observed_head": head, "operation_id": input.OperationID}) != nil {
			t.Fatal("native observation retention failed")
		}
		t.Log("safe observation artifact: observation.json")
		return
	}
	if e = savePublicationFile(filepath.Join(op, "intent.json"), input); e != nil {
		t.Fatal("native immutable intent conflict")
	}
	parent := input.Base
	if input.Action == "prepare_push" {
		if input.ExpectedHead != nil || input.PreviousOperationID != "" {
			t.Fatal("initial native parent rejected")
		}
		actual, e := readRef("refs/heads/main")
		if e != nil || actual != input.Base {
			t.Fatal("native public main baseline changed")
		}
		out, e := runPublicationAuthenticatedGitArgs(ctx, store, op, access, nil, []string{"fetch", "--no-tags", "--no-recurse-submodules", access.RemoteURL, input.Base + ":refs/monos/native/base"}, nil)
		if e != nil || !out.WorkerAbsent {
			t.Fatal("native verified public baseline fetch failed")
		}
	} else {
		if input.ExpectedHead == nil || !ValidID(input.PreviousOperationID) {
			t.Fatal("native correction requires original proof")
		}
		previous := filepath.Join(item.path, "operations", input.PreviousOperationID)
		var proof struct {
			Scope  string                 `json:"fixture_scope"`
			Input  publicationKernelInput `json:"input"`
			Head   string                 `json:"head"`
			Ref    string                 `json:"delivery_ref"`
			Absent bool                   `json:"worker_absent"`
		}
		raw, e := readPublicationFile(filepath.Join(previous, "proof.json"))
		if e != nil || json.Unmarshal(raw, &proof) != nil || proof.Scope != "oauth_injected_remote_kernel" || proof.Input.TaskID != input.TaskID || proof.Input.ResourceID != input.ResourceID || proof.Input.ItemID != input.ItemID || proof.Input.Repository != input.Repository || proof.Input.RepositoryID != input.RepositoryID || proof.Head != *input.ExpectedHead || proof.Ref != access.DeliveryRef || !proof.Absent {
			t.Fatal("native correction original proof unavailable")
		}
		parent = proof.Head
	}
	actual, e := readRef(access.DeliveryRef)
	expected := ""
	if input.ExpectedHead != nil {
		expected = *input.ExpectedHead
	}
	_, startedErr := readPublicationFile(filepath.Join(op, "started.json"))
	if e != nil || startedErr != nil && (!os.IsNotExist(startedErr) || actual != expected) {
		t.Fatal("native advertised preflight head changed")
	}
	index := filepath.Join(op, "index")
	env := []string{"GIT_INDEX_FILE=" + index}
	if _, e = publicationMutatingGit(ctx, store, env, nil, "read-tree", parent); e != nil {
		t.Fatal("native controlled parent tree unavailable")
	}
	text := []byte("monos remote preparation synthetic kernel fixture\n" + input.SyntheticText + "\n")
	for _, rule := range publicationCredentialRules {
		if rule.pattern.Match(text) {
			t.Fatal("native synthetic text contains credential pattern")
		}
	}
	blob, e := publicationMutatingGit(ctx, store, nil, text, "hash-object", "-w", "--stdin")
	if e != nil {
		t.Fatal("native synthetic blob unavailable")
	}
	oid := strings.TrimSpace(string(blob))
	if !objectID.MatchString(oid) {
		t.Fatal("native synthetic blob malformed")
	}
	if _, e = publicationMutatingGit(ctx, store, env, nil, "update-index", "--add", "--cacheinfo", "100644,"+oid+",monos-remote-preparation-fixture.txt"); e != nil {
		t.Fatal("native synthetic tree update failed")
	}
	treeRaw, e := publicationMutatingGit(ctx, store, env, nil, "write-tree")
	if e != nil {
		t.Fatal("native synthetic tree unavailable")
	}
	tree := strings.TrimSpace(string(treeRaw))
	c := protocol.PublicationConstruction{Message: "monos Task " + input.TaskID + " result v1"}
	timestamp := filepath.Join(op, "timestamp.json")
	var retained struct {
		Timestamp string `json:"timestamp"`
	}
	if raw, e := readPublicationFile(timestamp); e == nil {
		if json.Unmarshal(raw, &retained) != nil {
			t.Fatal("native construction timestamp malformed")
		}
	} else if os.IsNotExist(e) {
		retained.Timestamp = fmtPublicationTimestamp()
		if savePublicationFile(timestamp, retained) != nil {
			t.Fatal("native construction timestamp unavailable")
		}
	} else {
		t.Fatal("native construction timestamp unavailable")
	}
	c.Timestamp = retained.Timestamp
	head, e := constructPublicationCommit(ctx, store, c, tree, []string{parent})
	if e != nil {
		t.Fatal("native controlled commit unavailable")
	}
	ref := "refs/monos/candidates/" + input.OperationID
	if raw, e := resultGit(ctx, store, 256, "rev-parse", "--verify", ref); e == nil {
		if strings.TrimSpace(string(raw)) != head {
			t.Fatal("native candidate ref conflict")
		}
	} else if _, e = publicationMutatingGit(ctx, store, nil, nil, "update-ref", ref, head, strings.Repeat("0", len(head))); e != nil {
		t.Fatal("native candidate CAS failed")
	}
	manifest := protocol.PublicationCandidateManifest{SchemaVersion: 1, CandidateID: input.OperationID, ConstructionID: input.OperationID, SourceDigest: publicationDigest(input), ConstructionDigest: publicationDigest(map[string]any{"input": input, "timestamp": retained.Timestamp}), Head: head, Tree: tree, Parents: []string{parent}}
	if savePublicationFile(filepath.Join(op, "candidate.json"), manifest) != nil {
		t.Fatal("native candidate retention failed")
	}
	scan := scanPublication(ctx, store, head, []string{parent}, "unknown", publicationDefaultLimits)
	if !scan.Complete || len(scan.Findings) > 0 {
		t.Fatal("native exact candidate scan blocked")
	}
	if savePublicationFile(filepath.Join(op, "scan.json"), map[string]any{"complete": scan.Complete, "workflow_changes": scan.WorkflowChanges, "findings_count": len(scan.Findings), "candidate_manifest_digest": publicationDigest(manifest)}) != nil {
		t.Fatal("native safe scan retention failed")
	}
	if _, e := readPublicationFile(filepath.Join(op, "started.json")); e == nil {
		actual, e = readRef(access.DeliveryRef)
		if e != nil || actual != head {
			t.Fatal("native started effect remains unresolved; no repeated push")
		}
	} else if os.IsNotExist(e) {
		if savePublicationFile(filepath.Join(op, "started.json"), map[string]any{"request_digest": publicationDigest(input), "head": head}) != nil {
			t.Fatal("native possible effect retention failed")
		}
		old := strings.Repeat("0", len(head))
		if expected != "" {
			old = expected
		}
		guard := publicationPushGuard{head, old, access.DeliveryRef, access.RemoteURL}
		out, _ := runPublicationAuthenticatedGit(ctx, store, op, access, &guard, func(worker publicationRemoteWorker) error {
			return savePublicationFile(filepath.Join(op, "worker.json"), worker)
		})
		if !out.WorkerAbsent {
			t.Fatal("native writer ownership unresolved")
		}
		if savePublicationFile(filepath.Join(op, "absence.json"), map[string]any{"worker_absent": true, "request_digest": publicationDigest(input)}) != nil {
			t.Fatal("native physical release retention failed")
		}
		actual, e = readRef(access.DeliveryRef)
		if e != nil || actual != head {
			t.Fatal("native started push remains unresolved")
		}
	} else {
		t.Fatal("native effect journal unavailable")
	}
	if _, e := readPublicationFile(filepath.Join(op, "absence.json")); e != nil {
		t.Fatal("native exact head alone cannot prove physical release")
	}
	proof := map[string]any{"schema_version": 1, "fixture_scope": "oauth_injected_remote_kernel", "input": input, "request_digest": publicationDigest(input), "candidate_manifest_digest": publicationDigest(manifest), "head": head, "tree": tree, "parents": manifest.Parents, "delivery_ref": access.DeliveryRef, "observed_head": actual, "worker_absent": true}
	if savePublicationFile(filepath.Join(op, "result.json"), map[string]any{"fixture_scope": "oauth_injected_remote_kernel", "operation_id": input.OperationID, "status": "published", "head": head, "observed_head": actual, "worker_absent": true}) != nil || savePublicationFile(filepath.Join(op, "proof.json"), proof) != nil {
		t.Fatal("native safe result/proof retention failed")
	}
	t.Log("safe native artifacts: candidate.json result.json proof.json")
}

func fmtPublicationTimestamp() string { return strconv.FormatInt(time.Now().Unix(), 10) + " +0000" }
