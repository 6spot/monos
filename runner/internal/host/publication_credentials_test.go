package host

import (
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

func TestRemotePreparationCredentialAnonymousPipeAndNoPersistence(t *testing.T) {
	root := publicationTestRoot(t)
	script, e := installPublicationAskpass(root)
	if e != nil {
		t.Fatal(e)
	}
	token := "synthetic-ephemeral-credential-do-not-persist"
	read, write, e := os.Pipe()
	if e != nil {
		t.Fatal(e)
	}
	defer read.Close()
	defer write.Close()
	done := make(chan struct{})
	go func() { _, _ = io.WriteString(write, token+"\n"); _ = write.Close(); close(done) }()
	cmd := exec.Command("/bin/sh", script, "Password for 'https://github.com/example/repository.git':")
	cmd.ExtraFiles = []*os.File{read}
	cmd.Env = publicationGitEnvironment()
	raw, e := cmd.Output()
	_ = read.Close()
	<-done
	if e != nil || strings.TrimSpace(string(raw)) != token {
		t.Fatal("fixed askpass anonymous pipe failed")
	}
	for _, arg := range append(cmd.Args, cmd.Env...) {
		if strings.Contains(arg, token) {
			t.Fatal("credential entered child arguments/environment")
		}
	}
	if e = filepath.WalkDir(root, func(path string, entry os.DirEntry, e error) error {
		if e != nil {
			return e
		}
		if entry.IsDir() {
			return nil
		}
		raw, e := os.ReadFile(path)
		if e != nil {
			return e
		}
		if strings.Contains(string(raw), token) {
			t.Fatal("credential persisted in private files")
		}
		return nil
	}); e != nil {
		t.Fatal(e)
	}
	if os.Chmod(script, 0600) != nil {
		t.Fatal("mode fixture failed")
	}
	if _, e = installPublicationAskpass(root); e == nil {
		t.Fatal("nonexecutable fixed credential helper accepted")
	}
}
