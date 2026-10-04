package host

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	protocol "monos.local/protocol"
)

func publicationStore(root string, s protocol.ResultReadIdentity) string {
	return filepath.Join(root, "stores", s.ResourceID, "public.git")
}

// Import only verified public parent graphs and the exact result tree. No source
// commit, private ancestry, borrowed alternates or original export ref is written.
func preparePublicationStore(ctx context.Context, root, source string, r protocol.PublicationPrepareRequest) (string, error) {
	if !ValidID(r.Source.ResourceID) {
		return "", errors.New("publication storage unavailable")
	}
	format, e := publicationStoreObjectFormat(ctx, source)
	if e != nil {
		return "", e
	}
	for _, p := range []string{root, filepath.Join(root, "stores"), filepath.Join(root, "stores", r.Source.ResourceID)} {
		if publicationDirectory(p) != nil {
			return "", errors.New("publication storage unavailable")
		}
	}
	owner := filepath.Join(root, "stores", r.Source.ResourceID)
	lock, e := acquireFileLock(ctx, filepath.Join(owner, "lock"))
	if e != nil {
		return "", e
	}
	defer releaseFileLock(lock)
	if e = savePublicationFile(filepath.Join(owner, "identity.json"), map[string]string{"resource_id": r.Source.ResourceID, "runner_id": r.Source.RunnerID, "storage_id": r.Source.StorageID, "repository_identity": r.Source.RepositoryIdentity}); e != nil {
		return "", e
	}
	store := publicationStore(root, r.Source)
	if _, e = os.Lstat(store); os.IsNotExist(e) {
		if publicationDirectory(store) != nil {
			return "", errors.New("publication storage unavailable")
		}
		cmd := exec.CommandContext(ctx, "/usr/bin/git", "-c", "core.hooksPath=/dev/null", "init", "--bare", "--quiet", "--object-format="+format, store)
		cmd.Env = publicationGitEnvironment()
		cmd.Stderr = io.Discard
		if cmd.Run() != nil {
			return "", errors.New("publication storage unavailable")
		}
	}
	if publicationGitStorage(ctx, store) != nil {
		return "", errors.New("publication storage unavailable")
	}
	if verifyPublicationStoreConfiguration(ctx, store) != nil {
		return "", errors.New("publication storage unavailable")
	}
	storeFormat, e := publicationStoreObjectFormat(ctx, store)
	if e != nil || storeFormat != format {
		return "", errors.New("publication storage object format mismatch")
	}
	objects := []string{r.Source.GitTree}
	for _, p := range r.Construction.Parents {
		if p.Kind != "published" {
			objects = append(objects, p.Commit)
		}
	}
	if e = importPublicationObjects(ctx, source, store, objects); e != nil {
		return "", e
	}
	return store, nil
}

func publicationStoreObjectFormat(ctx context.Context, dir string) (string, error) {
	raw, e := resultGit(ctx, dir, 16, "rev-parse", "--show-object-format=storage")
	if e != nil || string(raw) != "sha1\n" && string(raw) != "sha256\n" {
		return "", errors.New("publication storage object format unavailable")
	}
	return strings.TrimSuffix(string(raw), "\n"), nil
}

func verifyPublicationStoreConfiguration(ctx context.Context, store string) error {
	raw, e := resultGit(ctx, store, 16384, "config", "--local", "--no-includes", "--null", "--list")
	if e != nil {
		return e
	}
	allowed := map[string]map[string]bool{"core.repositoryformatversion": {"0": true, "1": true}, "core.filemode": {"true": true, "false": true}, "core.bare": {"true": true}, "core.logallrefupdates": {"true": true, "false": true}, "extensions.objectformat": {"sha1": true, "sha256": true}, "core.ignorecase": {"true": true, "false": true}, "core.precomposeunicode": {"true": true, "false": true}}
	seen := map[string]bool{}
	for _, record := range strings.Split(string(raw), "\x00") {
		if record == "" {
			continue
		}
		pair := strings.SplitN(record, "\n", 2)
		if len(pair) != 2 || seen[pair[0]] || !allowed[pair[0]][pair[1]] {
			return errors.New("publication store configuration unavailable")
		}
		seen[pair[0]] = true
	}
	if !seen["core.bare"] || !seen["core.repositoryformatversion"] {
		return errors.New("publication store configuration unavailable")
	}
	return nil
}

type publicationPackWriter struct {
	file   *os.File
	count  int64
	cancel context.CancelFunc
}

func (w *publicationPackWriter) Write(p []byte) (int, error) {
	if int64(len(p)) > (1<<30)-w.count {
		w.cancel()
		return 0, errors.New("publication object import limit")
	}
	n, e := w.file.Write(p)
	w.count += int64(n)
	return n, e
}

func importPublicationObjects(ctx context.Context, source, destination string, objects []string) error {
	for _, oid := range objects {
		if !objectID.MatchString(oid) {
			return errors.New("publication object unavailable")
		}
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	f, e := os.CreateTemp(filepath.Dir(destination), ".public-pack-")
	if e != nil {
		return errors.New("publication object unavailable")
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if f.Chmod(0600) != nil {
		return errors.New("publication object unavailable")
	}
	cmd := exec.CommandContext(ctx, "/usr/bin/git", "--no-replace-objects", "--git-dir="+source, "-c", "safe.directory="+source, "-c", "core.hooksPath=/dev/null", "pack-objects", "--stdout", "--revs")
	cmd.Env = publicationGitEnvironment()
	cmd.Stdin = strings.NewReader(strings.Join(objects, "\n") + "\n")
	cmd.Stdout = &publicationPackWriter{file: f, cancel: cancel}
	cmd.Stderr = io.Discard
	if cmd.Run() != nil || f.Sync() != nil {
		return errors.New("publication object unavailable")
	}
	if _, e = f.Seek(0, 0); e != nil {
		return e
	}
	cmd = exec.CommandContext(ctx, "/usr/bin/git", "--git-dir="+destination, "-c", "safe.directory="+destination, "-c", "core.hooksPath=/dev/null", "-c", "core.fsync=loose-object,pack", "index-pack", "--stdin", "--fix-thin")
	cmd.Env = publicationGitEnvironment()
	cmd.Stdin = f
	cmd.Stdout = io.Discard
	cmd.Stderr = io.Discard
	if cmd.Run() != nil {
		return errors.New("publication object unavailable")
	}
	return nil
}

func verifyPublicationPreparationPages(ctx context.Context, root string, r protocol.PublicationPrepareRequest, prepared protocol.PublicationPushRequestPrepared) ([]protocol.PublicationFinding, error) {
	raw, e := readPublicationFile(filepath.Join(root, "operations", r.OperationID, "intent.json"))
	if e != nil || !bytes.Equal(raw, mustPublicationCanonical(r)) {
		return nil, errors.New("publication preparation unavailable")
	}
	raw, e = readPublicationFile(filepath.Join(root, "operations", r.OperationID, "pages.json"))
	if e != nil {
		return nil, e
	}
	var pages []protocol.PublicationResultPage
	if json.Unmarshal(raw, &pages) != nil || len(pages) == 0 || !bytes.Equal(mustPublicationCanonical(pages[0].Result), mustPublicationCanonical(prepared)) {
		return nil, errors.New("publication preparation mismatch")
	}
	findings := []protocol.PublicationFinding{}
	for i, page := range pages {
		if page.PageIndex != int64(i) || page.PageCount != int64(len(pages)) || publicationDigest(page.Result) != publicationDigest(prepared) || publicationDigest(page.Findings) != page.PageDigest {
			return nil, errors.New("publication page mismatch")
		}
		findings = append(findings, page.Findings...)
	}
	if prepared.Scan == nil || int64(len(findings)) != prepared.Scan.FindingsCount || publicationDigest(findings) != prepared.Scan.FindingsDigest || int64(len(mustPublicationCanonical(findings))) != prepared.Scan.FindingsBytes {
		return nil, errors.New("publication findings mismatch")
	}
	if prepared.Candidate == nil {
		return nil, errors.New("publication candidate unavailable")
	}
	return findings, nil
}
