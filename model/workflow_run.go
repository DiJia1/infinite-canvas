package model

import "time"

// Run snapshots never reference the mutable definition through a cascading FK.
type WorkflowRun struct {
	ID            string     `json:"id" gorm:"primaryKey;size:128"`
	OwnerUID      string     `json:"-" gorm:"index;uniqueIndex:idx_workflow_run_request"`
	RequestID     string     `json:"requestId" gorm:"size:128;uniqueIndex:idx_workflow_run_request"`
	WorkflowID    string     `json:"workflowId" gorm:"index"`
	Revision      int        `json:"revision"`
	Title         string     `json:"title"`
	Snapshot      string     `json:"-" gorm:"type:text"`
	Status        string     `json:"status" gorm:"index"`
	StopRequested bool       `json:"stopRequested"`
	CreatedAt     time.Time  `json:"createdAt" gorm:"index"`
	UpdatedAt     time.Time  `json:"updatedAt"`
	FinishedAt    *time.Time `json:"finishedAt,omitempty"`
}

type WorkflowStepExecution struct {
	RunID  string `json:"runId" gorm:"primaryKey;size:128"`
	NodeID string `json:"nodeId" gorm:"primaryKey;size:128"`
	Status string `json:"status"`
	Error  string `json:"error,omitempty"`
}

type WorkflowOutputExecution struct {
	RunID     string    `json:"runId" gorm:"primaryKey;size:128"`
	NodeID    string    `json:"nodeId" gorm:"primaryKey;size:128"`
	SlotID    string    `json:"slotId" gorm:"primaryKey;size:128"`
	Status    string    `json:"status" gorm:"index"`
	Attempt   int       `json:"attempt"`
	MediaID   string    `json:"mediaId,omitempty"`
	Error     string    `json:"error,omitempty"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type WorkflowOutputAttempt struct {
	ID         string     `json:"id" gorm:"primaryKey;size:128"`
	RunID      string     `json:"runId" gorm:"uniqueIndex:idx_workflow_attempt_slot;index"`
	NodeID     string     `json:"nodeId" gorm:"uniqueIndex:idx_workflow_attempt_slot"`
	SlotID     string     `json:"slotId" gorm:"uniqueIndex:idx_workflow_attempt_slot"`
	Attempt    int        `json:"attempt" gorm:"uniqueIndex:idx_workflow_attempt_slot"`
	OwnerUID   string     `json:"-" gorm:"uniqueIndex:idx_workflow_attempt_request"`
	RequestID  string     `json:"requestId" gorm:"size:128;uniqueIndex:idx_workflow_attempt_request"`
	TaskType   string     `json:"taskType"`
	TaskID     string     `json:"taskId,omitempty" gorm:"index"`
	Status     string     `json:"status" gorm:"index"`
	Error      string     `json:"error,omitempty"`
	MediaID    string     `json:"mediaId,omitempty"`
	ClaimID    string     `json:"-"`
	LeaseUntil *time.Time `json:"-" gorm:"index"`
	NextPollAt time.Time  `json:"-" gorm:"index"`
	CreatedAt  time.Time  `json:"createdAt"`
	UpdatedAt  time.Time  `json:"updatedAt"`
	FinishedAt *time.Time `json:"finishedAt,omitempty"`
}
