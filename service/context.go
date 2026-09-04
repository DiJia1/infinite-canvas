package service

import "context"

type portalUserContextKey struct{}

type PortalUser struct {
	UID      string   `json:"uid"`
	Username string   `json:"username"`
	Roles    []string `json:"roles"`
}

func WithPortalUser(ctx context.Context, user PortalUser) context.Context {
	return context.WithValue(ctx, portalUserContextKey{}, user)
}

func PortalUserFromContext(ctx context.Context) (PortalUser, bool) {
	user, ok := ctx.Value(portalUserContextKey{}).(PortalUser)
	return user, ok
}
