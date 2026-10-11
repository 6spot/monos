package host

import (
	"context"
	"encoding/json"
	"encoding/pem"
	"errors"
	"net/http"
	"net/http/cgi"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	protocol "monos.local/protocol"
	"monos.local/runner/internal/wire"
)

func TestPlainGitScanRetainsLocalPolicyAndWorkflowFacts(t *testing.T) {
	work, base := scanFixture(t)
	resultTestWrite(t, work, ".github/workflows/check.yml", []byte("name: test\n"))
	head := scanCommit(t, work)
	limits := publicationDefaultLimits
	limits.ProviderBytes, limits.PolicyBytes = 0, 8
	out := scanPublication(context.Background(), scanDir(t, work), head, []string{base}, "not_applicable", limits)
	if !out.Complete || !out.WorkflowChanges || !hasScanRule(out, "policy_blob_size", ".github/workflows/check.yml") {
		t.Fatal("plain scan lost local policy or workflow facts", out)
	}
	for _, finding := range out.Findings {
		if finding.Rule == "provider_blob_size" || finding.Rule == "workflow_permission" {
			t.Fatal("plain scan invented provider policy")
		}
	}
}

func TestPlainGitFreshRefReadsKeepOriginalPushImmutable(t *testing.T) {
	f := publicationPushTestFixtureEndpoint(t, "", "repo", "https://Git.Example:8443/Team/Repo.git")
	result, e := f.run(context.Background())
	if e != nil || result.Status != "published" || f.pushes.Load() != 1 {
		t.Fatal("plain push failed", result, e)
	}
	op := filepath.Join(f.remoteRoot, "items", f.request.ItemID, "operations", f.request.OperationID)
	before, _ := os.ReadFile(filepath.Join(op, "result.json"))
	refs := resultTestGit(t, f.store, nil, "show-ref")
	r := protocol.PublicationRefReadRequest{SchemaVersion: 1, RequestID: "fresh", Push: f.request, PushRequestDigest: publicationDigest(f.request)}
	access := f.io.access
	f.io.access = func(ctx context.Context, p protocol.PublicationPushRequest, purpose protocol.PublicationAccessRequestPurpose, attempt string) (protocol.PublicationAccessResult, error) {
		if purpose != "observe" {
			t.Fatal("read acquired write access")
		}
		a, e := access(ctx, p, purpose, attempt)
		a.Authentication = protocol.RepositoryAuthentication{Kind: "anonymous"}
		return a, e
	}
	for _, status := range []string{"present", "moved", "absent"} {
		if status == "moved" {
			resultTestGit(t, f.remote, nil, "update-ref", f.request.DeliveryRef, f.source.base)
		}
		if status == "absent" {
			resultTestGit(t, f.remote, nil, "update-ref", "-d", f.request.DeliveryRef)
		}
		response, e := publicationRefReadAt(context.Background(), r, f.root, f.remoteRoot, f.io)
		if e != nil || !response.WorkerAbsent || response.Request.RequestID != r.RequestID || response.ObservationDigest != publicationDigest(response.Observation) {
			t.Fatal("fresh read failed", response, e)
		}
		want := f.request.Prepared.Candidate.Head
		if status == "moved" {
			want = f.source.base
		}
		if status == "absent" {
			if response.Observation.Status != "absent" || response.Observation.Head != nil {
				t.Fatal("deletion was not observed")
			}
		} else if response.Observation.Head == nil || *response.Observation.Head != want {
			t.Fatal("stale observation returned")
		}
	}
	after, _ := os.ReadFile(filepath.Join(op, "result.json"))
	if string(before) != string(after) || refs != resultTestGit(t, f.store, nil, "show-ref") || f.pushes.Load() != 1 {
		t.Fatal("read mutated original result or Git graph")
	}
	replayed, e := f.run(context.Background())
	if e != nil || publicationDigest(replayed) != publicationDigest(result) {
		t.Fatal("original replay changed after fresh read")
	}
	unresolved := f.io
	unresolved.observe = func(context.Context, string, string, protocol.PublicationAccessResult) (publicationRemoteExecution, error) {
		return publicationRemoteExecution{WorkerAbsent: false}, errors.New("unsettled")
	}
	if _, e = publicationRefReadAt(context.Background(), r, f.root, f.remoteRoot, unresolved); e == nil {
		t.Fatal("unresolved read worker produced an observation")
	}
	foreign := r
	foreign.Push.OperationID = "foreign-push"
	foreign.PushRequestDigest = publicationDigest(foreign.Push)
	noAccess := f.io
	noAccess.access = func(context.Context, protocol.PublicationPushRequest, protocol.PublicationAccessRequestPurpose, string) (protocol.PublicationAccessResult, error) {
		t.Fatal("unretained intent contacted remote")
		return protocol.PublicationAccessResult{}, errors.New("unexpected")
	}
	if _, e = publicationRefReadAt(context.Background(), foreign, f.root, f.remoteRoot, noAccess); e == nil {
		t.Fatal("unretained original push accepted")
	}
	if e = os.Remove(filepath.Join(op, "absence.json")); e != nil {
		t.Fatal(e)
	}
	f.io.access = func(context.Context, protocol.PublicationPushRequest, protocol.PublicationAccessRequestPurpose, string) (protocol.PublicationAccessResult, error) {
		t.Fatal("read without original absence contacted remote")
		return protocol.PublicationAccessResult{}, errors.New("unexpected")
	}
	if _, e = publicationRefReadAt(context.Background(), r, f.root, f.remoteRoot, f.io); e == nil {
		t.Fatal("matching remote could substitute worker absence")
	}
}

func TestPlainGitCredentialInputBoundsAndLocalExpiry(t *testing.T) {
	remote := "https://git.example/Team/Repo.git"
	valid := protocol.RepositoryAuthentication{Kind: "https_basic", Username: publicationPointer("git-user"), Token: publicationPointer("test-token"), ExpiresAt: publicationPointer(time.Now().Add(time.Hour).UTC().Format(time.RFC3339))}
	if _, _, e := repositoryCredentials(remote, valid, 0); e != nil {
		t.Fatal(e)
	}
	unicodeUsername := valid
	unicodeUsername.Username = publicationPointer(strings.Repeat("界", 256))
	if _, _, e := repositoryCredentials(remote, unicodeUsername, 0); e != nil {
		t.Fatal("bounded Unicode username rejected", e)
	}
	for _, mutate := range []func(*protocol.RepositoryAuthentication){
		func(a *protocol.RepositoryAuthentication) { a.Token = publicationPointer(strings.Repeat("界", 2000)) },
		func(a *protocol.RepositoryAuthentication) { a.Token = publicationPointer("secret\r\nheader") },
		func(a *protocol.RepositoryAuthentication) { a.Username = publicationPointer("user:other") },
		func(a *protocol.RepositoryAuthentication) {
			a.ExpiresAt = publicationPointer(time.Now().Add(-time.Second).UTC().Format(time.RFC3339))
		},
		func(a *protocol.RepositoryAuthentication) { a.Kind = "anonymous" },
		func(a *protocol.RepositoryAuthentication) { a.Kind = "github_installation"; a.Username = nil },
	} {
		a := valid
		mutate(&a)
		if _, _, e := repositoryCredentials(remote, a, 0); e == nil {
			t.Fatal("invalid repository credential accepted")
		}
	}
}

func TestPlainGitPushBindsScopeAndExactEndpoint(t *testing.T) {
	f := publicationPushTestFixtureEndpoint(t, "", "repo", "https://git.example:8443/Team/Repo.git")
	r := f.request
	local := r.Preparation
	local.PermissionProof, local.PermissionProofDigest = nil, nil
	if e := ValidatePublicationRequest(local); e != nil {
		t.Fatal("anonymous local preparation required credentials", e)
	}
	a, e := f.io.access(context.Background(), r, "push", "attempt")
	if e != nil || validatePublicationAccess(r, a, "push") != nil {
		t.Fatal("plain access rejected", e)
	}
	// Same-scope material rotation may keep authorization without retaining a token.
	p := *a.PermissionProof
	p.ConfigurationFingerprint = strings.Repeat("d", 64)
	p.ConfigurationRequestID = publicationPointer("rotated")
	a.PermissionProof, a.PermissionProofDigest = &p, publicationPointer(publicationDigest(p))
	if validatePublicationAccess(r, a, "push") != nil {
		t.Fatal("same-scope rotation changed permission")
	}
	for _, mutate := range []func(*protocol.PublicationAccessResult){
		func(a *protocol.PublicationAccessResult) {
			a.RemoteURL = strings.Replace(a.RemoteURL, "/Team/", "/team/", 1)
		},
		func(a *protocol.PublicationAccessResult) {
			a.ProviderMetadata.Github = &protocol.GithubClass{RepositoryID: "123"}
		},
		func(a *protocol.PublicationAccessResult) { a.Authentication.Username = publicationPointer("other") },
		func(a *protocol.PublicationAccessResult) {
			a.Authentication.Kind = "anonymous"
			a.Authentication.Token = nil
			a.Authentication.ExpiresAt = nil
			a.Authentication.Username = nil
		},
	} {
		changed := a
		mutate(&changed)
		if validatePublicationAccess(r, changed, "push") == nil {
			t.Fatal("crossed plain publication authority accepted")
		}
	}
}

func TestPlainGitInspectionPinsAndRejectsChangedEndpoint(t *testing.T) {
	root, op, f := inspectionFixture(t, "plain-inspection")
	op.Inspection.Resource = protocol.WorkspaceResource{ResourceID: "repo", RepositoryIdentity: "git.example:8443/Team/Repo", RemoteURL: "https://git.example:8443/Team/Repo.git", DefaultBranch: publicationPointer("main")}
	op.InspectionDigest = publicationPointer(publicationDigest(op.Inspection))
	a := protocol.InspectionRepositoryAccessResult{SchemaVersion: 1, OperationID: op.OperationID, InspectionDigest: *op.InspectionDigest, RemoteURL: op.Inspection.Resource.RemoteURL, DefaultBranch: "main", Authentication: protocol.RepositoryAuthentication{Kind: "anonymous"}}
	if _, e := inspectionAccessEnvironment(op, a); e != nil {
		t.Fatal("plain inspection grant rejected", e)
	}
	changed := a
	changed.RemoteURL = strings.Replace(a.RemoteURL, "/Team/", "/team/", 1)
	if _, e := inspectionAccessEnvironment(op, changed); e == nil {
		t.Fatal("changed plain endpoint accepted")
	}
	fetch := func(ctx context.Context, s *inspectionSession) (string, string, string, error) {
		s.remoteGit = func(ctx context.Context, repo string, env []string, args ...string) (string, error) {
			for n, v := range args {
				if v == a.RemoteURL {
					args[n] = f.export
				}
			}
			return s.git(ctx, repo, env, append([]string{"-c", "protocol.file.allow=always"}, args...)...)
		}
		return s.fetch(ctx, func(context.Context, protocol.Operation) (protocol.InspectionRepositoryAccessResult, error) {
			return a, nil
		})
	}
	result, e := inspectRepositoryAt(context.Background(), root, "storage", op, nil, fetch)
	if e != nil || result.Inspection == nil || result.Inspection.Status != "available" || result.Inspection.Snapshot.Commit != f.request.Identity.GitCommit {
		t.Fatal("plain inspection failed", result, e)
	}
}

// A private CGI Git server and CA exercise real HTTPS without external services.
func TestPlainGitControlledTLSCredentialsPushAndRefRead(t *testing.T) {
	root := publicationTestRoot(t)
	remote := filepath.Join(root, "Team", "Repo.git")
	if e := os.Mkdir(filepath.Dir(remote), 0700); e != nil {
		t.Fatal(e)
	}
	resultTestGit(t, root, nil, "init", "--bare", "--quiet", remote)
	resultTestGit(t, remote, nil, "config", "http.receivepack", "true")
	execPath, e := exec.Command("/usr/bin/git", "--exec-path").Output()
	if e != nil {
		t.Fatal(e)
	}
	backend := &cgi.Handler{Path: filepath.Join(strings.TrimSpace(string(execPath)), "git-http-backend"), Dir: root, Env: []string{"GIT_PROJECT_ROOT=" + root, "GIT_HTTP_EXPORT_ALL=1", "GIT_CONFIG_NOSYSTEM=1", "GIT_CONFIG_GLOBAL=/dev/null"}}
	var calls, authorized, redirected atomic.Int64
	var reject, redirect, public atomic.Bool
	token, username := "synthetic-static-https-token", "git-user"
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/Team/Repo.git/info/refs" && r.URL.Path != "/Team/Repo.git/git-receive-pack" && r.URL.Path != "/Team/Repo.git/git-upload-pack" {
			t.Errorf("endpoint path changed: %s", r.URL.Path)
			w.WriteHeader(404)
			return
		}
		if redirect.Load() {
			redirected.Add(1)
			http.Redirect(w, r, "/Elsewhere.git/info/refs", http.StatusTemporaryRedirect)
			return
		}
		u, p, ok := r.BasicAuth()
		if !public.Load() && (!ok || u != username || p != token || reject.Load()) {
			w.Header().Set("WWW-Authenticate", `Basic realm="test"`)
			w.WriteHeader(401)
			return
		}
		if ok {
			authorized.Add(1)
		}
		backend.ServeHTTP(w, r)
	}))
	defer server.Close()
	ca := filepath.Join(root, "ca.pem")
	if e = os.WriteFile(ca, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: server.Certificate().Raw}), 0600); e != nil {
		t.Fatal(e)
	}
	f := publicationPushTestFixtureEndpoint(t, "", "repo", server.URL+"/Team/Repo.git")
	f.io = publicationRemoteProduction(func(ctx context.Context, r protocol.PublicationPushRequest, purpose protocol.PublicationAccessRequestPurpose, attempt string) (protocol.PublicationAccessResult, error) {
		expires := time.Now().Add(time.Hour).UTC().Format(time.RFC3339)
		a := protocol.PublicationAccessResult{SchemaVersion: 1, OperationID: r.OperationID, RequestDigest: publicationDigest(r), ItemID: r.ItemID, AttemptID: attempt, Purpose: purpose, RemoteURL: r.RemoteURL, ProviderMetadata: r.ProviderMetadata, DeliveryRef: r.DeliveryRef, CandidateHead: r.Prepared.Candidate.Head, ExpectedHead: r.ExpectedHead, Authentication: protocol.RepositoryAuthentication{Kind: "https_basic", Username: &username, Token: &token, ExpiresAt: &expires}}
		if purpose == "push" {
			a.PermissionProof = &r.PermissionProof
			a.PermissionProofDigest = &r.PermissionProofDigest
			a.ClaimID = publicationPointer("claim")
			a.ClaimExpiresAt = &expires
		}
		return a, nil
	})
	config := []string{"-c", "http.sslCAInfo=" + ca}
	f.io.observe = func(ctx context.Context, store, op string, a protocol.PublicationAccessResult) (publicationRemoteExecution, error) {
		return runPublicationAuthenticatedGitArgs(ctx, store, op, a, nil, config, nil)
	}
	f.io.push = func(ctx context.Context, store, op string, a protocol.PublicationAccessResult, guard publicationPushGuard, start func(publicationRemoteWorker) error) (publicationRemoteExecution, error) {
		return runPublicationAuthenticatedGitArgs(ctx, store, op, a, &guard, config, start)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	result, e := f.run(ctx)
	if e != nil || result.Status != "published" || authorized.Load() < 3 {
		t.Fatal("controlled HTTPS push failed", result.Status, result.Observation, e, authorized.Load())
	}
	// Exercise the same HTTPS Basic grant through the cache/inspection header path.
	resultTestGit(t, remote, nil, "update-ref", "refs/heads/main", f.request.Prepared.Candidate.Head)
	_, workspaceOp := canonicalWorkspace(t)
	workspaceOp.Workspace.Resource = protocol.WorkspaceResource{ResourceID: workspaceOp.Workspace.ResourceID, RepositoryIdentity: f.request.RepositoryIdentity, RemoteURL: f.request.RemoteURL, DefaultBranch: publicationPointer("main")}
	workspaceOp.WorkspaceDigest = publicationPointer(publicationDigest(workspaceOp.Workspace))
	grant, _ := f.io.access(ctx, f.request, "observe", "cache")
	cacheAccess := protocol.RepositoryAccessResult{SchemaVersion: 1, OperationID: workspaceOp.OperationID, WorkspaceDigest: *workspaceOp.WorkspaceDigest, RemoteURL: f.request.RemoteURL, DefaultBranch: "main", ProviderMetadata: f.request.ProviderMetadata, Authentication: grant.Authentication}
	cache := filepath.Join(root, "cache.git")
	metadata, e := fetchWorkspaceUsing(cache, filepath.Join(root, "pin.json"), workspaceOp, cacheAccess, func(dir, cache, common string, env []string, args ...string) (string, error) {
		return workspaceFetchGit(dir, cache, common, env, append(append([]string{}, config...), args...)...)
	})
	if e != nil || metadata.BaseCommit != f.request.Prepared.Candidate.Head {
		t.Fatal("HTTPS cache access failed", e)
	}
	op := filepath.Join(f.remoteRoot, "items", f.request.ItemID, "operations", f.request.OperationID)
	a, _ := f.io.access(ctx, f.request, "observe", "check")
	// Normal production trust refuses the private test CA.
	if out, e := runPublicationAuthenticatedGit(ctx, f.store, op, a, nil, nil); e == nil || !out.WorkerAbsent {
		t.Fatal("untrusted TLS accepted or worker remained")
	}
	reject.Store(true)
	if out, e := f.io.observe(ctx, f.store, op, a); e == nil || !out.WorkerAbsent {
		t.Fatal("authentication rejection accepted")
	}
	reject.Store(false)
	redirect.Store(true)
	before := calls.Load()
	if out, e := f.io.observe(ctx, f.store, op, a); e == nil || !out.WorkerAbsent || calls.Load()-before != 1 || redirected.Load() != 1 {
		t.Fatal("redirect followed or worker remained")
	}
	redirect.Store(false)
	public.Store(true)
	a.Authentication = protocol.RepositoryAuthentication{Kind: "anonymous"}
	if out, e := f.io.observe(ctx, f.store, op, a); e != nil || !strings.Contains(string(out.Output), f.request.Prepared.Candidate.Head) {
		t.Fatal("anonymous HTTPS observation failed", e)
	}
	if out, e := runPublicationAuthenticatedGitArgs(ctx, f.store, op, a, &publicationPushGuard{}, config, nil); e == nil || !out.WorkerAbsent {
		t.Fatal("anonymous write accepted")
	}
	for _, dir := range []string{root, f.root, f.remoteRoot} {
		if e = filepath.WalkDir(dir, func(path string, entry os.DirEntry, e error) error {
			if e != nil || entry.IsDir() {
				return e
			}
			raw, e := os.ReadFile(path)
			if strings.Contains(string(raw), token) {
				t.Errorf("credential persisted at %s", path)
			}
			return e
		}); e != nil {
			t.Fatal(e)
		}
	}
}

func TestPlainGitCachePinsExactEndpointAndMetadata(t *testing.T) {
	remote, base := fixtureRepository(t)
	branch, e := git(remote, "symbolic-ref", "--short", "HEAD")
	if e != nil {
		t.Fatal(e)
	}
	_, op := canonicalWorkspace(t)
	op.Workspace.Resource = protocol.WorkspaceResource{ResourceID: op.Workspace.ResourceID, RepositoryIdentity: "git.example:8443/Team/Repo", RemoteURL: "https://Git.Example:8443/Team/Repo.git", DefaultBranch: &branch}
	_, digest, _ := wire.Canonical(op.Workspace)
	op.WorkspaceDigest = &digest
	root := publicationTestRoot(t)
	a := protocol.RepositoryAccessResult{SchemaVersion: 1, OperationID: op.OperationID, WorkspaceDigest: digest, RemoteURL: op.Workspace.Resource.RemoteURL, DefaultBranch: branch, Authentication: protocol.RepositoryAuthentication{Kind: "anonymous"}}
	run := func(dir, cache, common string, env []string, args ...string) (string, error) {
		for i, v := range args {
			if v == a.RemoteURL {
				args[i] = remote
			}
		}
		return workspaceGit(dir, cache, common, nil, args...)
	}
	cache, pin := filepath.Join(root, "cache.git"), filepath.Join(root, "pin.json")
	m, e := fetchWorkspaceUsing(cache, pin, op, a, run)
	if e != nil || m.BaseCommit != base || m.ProviderMetadata == nil || m.ProviderMetadata.Github != nil {
		t.Fatal("plain cache pin failed", m, e)
	}
	var retained map[string]any
	raw, _ := os.ReadFile(pin)
	if json.Unmarshal(raw, &retained) != nil || retained["remote_url"] != a.RemoteURL {
		t.Fatal("exact endpoint not retained")
	}
	a.RemoteURL = strings.Replace(a.RemoteURL, "Git.Example", "git.example", 1)
	if _, e = fetchWorkspaceUsing(cache, pin, op, a, run); e == nil {
		t.Fatal("equivalent but unconfigured endpoint accepted")
	}
}

func TestPlainGitCacheNetworkOutputIsBounded(t *testing.T) {
	remote, base := fixtureRepository(t)
	if _, e := gitScopedOutputLimit(remote, nil, nil, 4, "rev-parse", "HEAD"); e == nil || strings.Contains(e.Error(), base) {
		t.Fatal("remote output was unbounded or exposed")
	}
	out, e := gitScopedOutputLimit(remote, nil, nil, 128, "rev-parse", "HEAD")
	if e != nil || out != base {
		t.Fatal("bounded Git changed successful output", e)
	}
}
