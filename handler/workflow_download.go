package handler

import (
	"context"
	"log"
	"net/http"
	"time"

	"github.com/basketikun/infinite-canvas/service"
)

func WorkflowRunImages(w http.ResponseWriter, r *http.Request, id string) {
	user, ok := service.PortalUserFromContext(r.Context())
	if !ok {
		FailStatus(w, http.StatusUnauthorized, "未经过 Portal Gateway 身份验证")
		return
	}
	timeout := service.WorkflowDownloadTimeout
	if r.URL.Query().Get("check") == "1" {
		timeout = 2 * time.Minute
	}
	ctx, cancel := context.WithTimeout(r.Context(), timeout)
	defer cancel()
	download, err := service.PrepareWorkflowImageDownload(ctx, user, id)
	if err != nil {
		writeWorkflowRunError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	if r.URL.Query().Get("check") == "1" {
		OK(w, download)
		return
	}
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(service.WorkflowDownloadTimeout))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", download.Disposition())
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Accel-Buffering", "no")
	if err := download.Write(ctx, w); err != nil {
		log.Printf("workflow image download interrupted run=%s", id)
		panic(http.ErrAbortHandler)
	}
}
