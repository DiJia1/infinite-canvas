package service

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/basketikun/infinite-canvas/model"
)

type downloadTestStore struct {
	imageStore
	open func(context.Context, string) (io.ReadCloser, error)
}

func (s downloadTestStore) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	return s.open(ctx, key)
}

func TestWorkflowDownloadSelectsCurrentSuccessfulSlotsInSnapshotOrder(t *testing.T) {
	detail := WorkflowRunDetail{
		Graph: model.WorkflowGraph{Nodes: []model.WorkflowNode{
			{ID: "input", Type: model.WorkflowNodeImageInput, MediaID: "input-media"},
			{ID: "a", Type: model.WorkflowNodeImageGeneration, Outputs: []model.WorkflowOutputSlot{{ID: "1", Type: model.WorkflowPortImage}, {ID: "2", Type: model.WorkflowPortImage}, {ID: "3", Type: model.WorkflowPortImage}}},
			{ID: "video", Type: model.WorkflowNodeVideoGeneration, Outputs: []model.WorkflowOutputSlot{{ID: "1", Type: model.WorkflowPortVideo}}},
			{ID: "b", Type: model.WorkflowNodeImageGeneration, Outputs: []model.WorkflowOutputSlot{{ID: "1", Type: model.WorkflowPortImage}}},
		}},
		Outputs: []model.WorkflowOutputExecution{
			{NodeID: "b", SlotID: "1", Status: "succeeded", MediaID: "b-new", Attempt: 2},
			{NodeID: "a", SlotID: "3", Status: "failed", MediaID: "a-old"},
			{NodeID: "a", SlotID: "2", Status: "running"},
			{NodeID: "video", SlotID: "1", Status: "succeeded", MediaID: "video"},
			{NodeID: "a", SlotID: "1", Status: "succeeded", MediaID: "a"},
		}, Attempts: []model.WorkflowOutputAttempt{{NodeID: "b", SlotID: "1", MediaID: "b-old", Status: "succeeded"}},
	}
	selected := workflowDownloadOutputs(detail)
	if len(selected) != 2 || selected[0].id != "a" || selected[1].id != "b-new" || selected[1].name != "03-01" {
		t.Fatalf("selected=%#v", selected)
	}
}

func TestWorkflowDownloadStreamsOriginalFilesAndClosesReaders(t *testing.T) {
	closed := 0
	d := WorkflowImageDownload{Filename: "中文.zip", store: downloadTestStore{open: func(_ context.Context, key string) (io.ReadCloser, error) {
		return &trackedDownloadReader{Reader: strings.NewReader(key), close: func() { closed++ }}, nil
	}}, images: []workflowDownloadImage{
		{media: model.Media{ObjectKey: "png-data", Bytes: 8}, name: "01-01.png"},
		{media: model.Media{ObjectKey: "jpeg-data", Bytes: 9}, name: "02-01.jpg"},
	}}
	var out bytes.Buffer
	if err := d.Write(context.Background(), &out); err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(out.Bytes()), int64(out.Len()))
	if err != nil {
		t.Fatal(err)
	}
	if len(archive.File) != 2 || closed != 2 {
		t.Fatalf("files=%d closed=%d", len(archive.File), closed)
	}
	for i, expected := range []string{"png-data", "jpeg-data"} {
		r, _ := archive.File[i].Open()
		body, _ := io.ReadAll(r)
		r.Close()
		if string(body) != expected {
			t.Fatalf("body=%q", body)
		}
	}
	if !strings.Contains(d.Disposition(), "attachment") || strings.Contains(workflowDownloadName("../a\r\n/b"), "/") {
		t.Fatal("invalid filename")
	}
}

type trackedDownloadReader struct {
	io.Reader
	close func()
}

func (r *trackedDownloadReader) Close() error { r.close(); return nil }

func TestWorkflowDownloadDoesNotFinalizeTruncatedOrFailedSource(t *testing.T) {
	for _, fail := range []bool{false, true} {
		d := WorkflowImageDownload{store: downloadTestStore{open: func(context.Context, string) (io.ReadCloser, error) {
			if fail {
				return nil, errors.New("storage unavailable")
			}
			return io.NopCloser(strings.NewReader("short")), nil
		}}, images: []workflowDownloadImage{{media: model.Media{Bytes: 10}, name: "01-01.png"}}}
		var out bytes.Buffer
		if d.Write(context.Background(), &out) == nil {
			t.Fatal("expected failure")
		}
		if _, err := zip.NewReader(bytes.NewReader(out.Bytes()), int64(out.Len())); err == nil {
			t.Fatal("incomplete archive was finalized")
		}
	}
}

type blockedDownloadReader struct {
	closed chan struct{}
	once   sync.Once
}

func (r *blockedDownloadReader) Read([]byte) (int, error) { <-r.closed; return 0, io.ErrClosedPipe }
func (r *blockedDownloadReader) Close() error             { r.once.Do(func() { close(r.closed) }); return nil }
func TestWorkflowDownloadCancellationReleasesBlockedReader(t *testing.T) {
	body := &blockedDownloadReader{closed: make(chan struct{})}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	d := WorkflowImageDownload{store: downloadTestStore{open: func(context.Context, string) (io.ReadCloser, error) { return body, nil }}, images: []workflowDownloadImage{{media: model.Media{Bytes: 2}, name: "01-01.png"}}}
	done := make(chan error, 1)
	go func() { done <- d.Write(ctx, io.Discard) }()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected canceled read")
		}
	case <-time.After(time.Second):
		t.Fatal("reader was not released")
	}
}
