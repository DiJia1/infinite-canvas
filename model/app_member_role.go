package model

import "time"

type AppRole string

const (
	AppRoleMember              AppRole = "member"
	AppRolePublicAssetsManager AppRole = "public_assets_manager"
	AppRoleAdmin               AppRole = "admin"
)

// AppMemberRole stores only explicit, non-default application roles.
type AppMemberRole struct {
	UserUID      string    `json:"userUid" gorm:"primaryKey"`
	Role         AppRole   `json:"role" gorm:"not null;index"`
	GrantedByUID string    `json:"grantedByUid"`
	CreatedAt    time.Time `json:"createdAt"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

// AppRBACState is a singleton used for one-time bootstrap state and role-write serialization.
type AppRBACState struct {
	ID                   uint       `gorm:"primaryKey;autoIncrement:false"`
	BootstrapCompletedAt *time.Time `json:"bootstrapCompletedAt"`
	UpdatedAt            time.Time  `json:"updatedAt"`
}

func (AppRBACState) TableName() string { return "app_rbac_state" }
