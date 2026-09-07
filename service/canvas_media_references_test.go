package service

import (
	"reflect"
	"testing"

	"github.com/basketikun/infinite-canvas/repository"
)

func TestCanvasDocumentMediaIDsReturnsOnlyPersistedImageMedia(t *testing.T) {
	document := []byte(`{
		"nodes": [
			{"id":"image-1","type":"image","metadata":{"mediaId":"media-a"}},
			{"id":"image-2","type":"image","metadata":{"mediaId":"media-a"}},
			{"id":"uploading","type":"image","metadata":{"storageKey":"local:upload"}},
			{"id":"text","type":"text","metadata":{"mediaId":"not-media"}},
			{"id":"legacy","type":"image","data":{"mediaId":"not-metadata"}}
		]
	}`)

	got, err := repository.CanvasDocumentMediaIDs(document)
	if err != nil {
		t.Fatalf("CanvasDocumentMediaIDs(): %v", err)
	}
	want := map[string]struct{}{"media-a": {}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("canvasDocumentMediaIDs() = %#v, want %#v", got, want)
	}
}
