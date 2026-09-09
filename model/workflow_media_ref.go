package model

// WorkflowMediaRef holds stable media for a definition or an immutable run.
// Access belongs to OwnerUID; cleanup must check references across all owners.
type WorkflowMediaRef struct {
	OwnerUID string `json:"-" gorm:"primaryKey;size:128"`
	Scope    string `json:"-" gorm:"primaryKey;size:16"`
	ScopeID  string `json:"-" gorm:"primaryKey;size:128"`
	MediaID  string `json:"mediaId" gorm:"primaryKey;size:128;index"`
}
