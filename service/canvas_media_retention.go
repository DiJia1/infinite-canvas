package service

import (
	"context"
	"log"
	"time"

	"github.com/basketikun/infinite-canvas/repository"
)

const canvasMediaCleanupInterval = time.Minute
const canvasMediaCleanupLease = 2 * time.Minute
const canvasMediaDeleteTimeout = 30 * time.Second

func CleanupExpiredCanvasMedia(current time.Time) error {
	return cleanupExpiredCanvasMedia(context.Background(), current, newImageStore)
}

func cleanupExpiredCanvasMedia(ctx context.Context, current time.Time, createStore func() (imageStore, error)) error {
	items, err := repository.ListExpiredPrivateMedia(current)
	if err != nil {
		return err
	}
	store, err := createStore()
	if err != nil {
		return err
	}
	for _, candidate := range items {
		if err := ctx.Err(); err != nil {
			return err
		}
		item, claimed, err := repository.ClaimCanvasMediaCleanup(candidate.ID, current, canvasMediaCleanupLease)
		if err != nil {
			log.Printf("canvas media cleanup claim failed media_id=%s: %v", candidate.ID, err)
			continue
		}
		if !claimed {
			continue
		}
		deleteCtx, cancel := context.WithTimeout(ctx, canvasMediaDeleteTimeout)
		err = deleteImageObject(deleteCtx, store, item.ObjectKey)
		cancel()
		if err != nil {
			log.Printf("canvas media cleanup object delete failed media_id=%s claim_id=%s: %v", item.ID, item.CleanupClaimID, err)
			continue
		}
		if _, err := repository.DeleteClaimedCanvasMedia(item.ID, item.CleanupClaimID); err != nil {
			log.Printf("canvas media cleanup record delete failed media_id=%s claim_id=%s: %v", item.ID, item.CleanupClaimID, err)
		}
	}
	return nil
}

func StartCanvasMediaRetention(ctx context.Context) func() {
	ctx, cancel := context.WithCancel(ctx)
	if err := cleanupExpiredCanvasMedia(ctx, time.Now(), newImageStore); err != nil {
		log.Printf("canvas media cleanup failed: %v", err)
	}
	go func() {
		ticker := time.NewTicker(canvasMediaCleanupInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case current := <-ticker.C:
				if err := cleanupExpiredCanvasMedia(ctx, current, newImageStore); err != nil {
					log.Printf("canvas media cleanup failed: %v", err)
				}
			}
		}
	}()
	return cancel
}
