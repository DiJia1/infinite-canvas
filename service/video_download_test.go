package service

import (
	"context"
	"errors"
	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss"
	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss/credentials"
	"github.com/basketikun/infinite-canvas/model"
	"mime"
	"net/url"
	"strings"
	"testing"
	"time"
)

func TestVideoDownloadSignature(t *testing.T) {
	client := oss.NewClient(oss.LoadDefaultConfig().WithRegion("cn-hongkong").WithCredentialsProvider(credentials.NewStaticCredentialsProvider("test-id", "test-secret")))
	store := &ossImageStore{public: client, bucket: "test-bucket", ttl: time.Minute}
	disposition := VideoDownloadDisposition("canvas-video-node.mp4")
	address, _, err := store.SignedDownloadURL(context.Background(), "video.mp4", disposition)
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ := url.Parse(address)
	if parsed.Query().Get("response-content-disposition") != disposition || parsed.Query().Get("x-oss-process") != "" {
		t.Fatal("missing attachment or unexpected snapshot")
	}
	playback, _, err := store.SignedURL(context.Background(), "video.mp4", "")
	if err != nil {
		t.Fatal(err)
	}
	parsed, _ = url.Parse(playback)
	if parsed.Query().Has("response-content-disposition") {
		t.Fatal("playback must remain inline")
	}
}
func TestVideoDownloadFilename(t *testing.T) {
	for _, name := range []string{"canvas-video-node.mp4", "../片段\r\n\"/\\.mp4", "", strings.Repeat("长", 300)} {
		header := VideoDownloadDisposition(name)
		kind, params, err := mime.ParseMediaType(header)
		if err != nil || kind != "attachment" || !strings.HasSuffix(strings.ToLower(params["filename"]), ".mp4") || strings.ContainsAny(params["filename"], "/\\\r\n\"") {
			t.Fatalf("invalid header %q", header)
		}
	}
}

type failedDownloadStore struct{ localImageStore }

func (failedDownloadStore) SignedDownloadURL(context.Context, string, string) (string, time.Time, error) {
	return "", time.Time{}, errors.New("signing failed")
}
func TestVideoDownloadSigningFailure(t *testing.T) {
	if _, err := videoDownloadAccess(context.Background(), failedDownloadStore{}, model.Media{ID: "v"}, "v.mp4"); err == nil {
		t.Fatal("signing failure ignored")
	}
}
