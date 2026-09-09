package repository

import (
	"crypto/sha256"
	"fmt"

	"github.com/google/uuid"
)

func randomUUID() string { return uuid.NewString() }

func workflowAttemptRequestID(runID, nodeID, slotID string, attempt int) string {
	// Hash the stable slot identity so arbitrary graph IDs cannot exceed the
	// generation APIs' 128-byte client request limit.
	digest := sha256.Sum256([]byte(fmt.Sprintf("%s\x00%s\x00%s\x00%d", runID, nodeID, slotID, attempt)))
	return fmt.Sprintf("workflow-%x", digest)
}
