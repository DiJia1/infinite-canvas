package service

import (
	"context"
	"errors"
	"fmt"
	"github.com/aliyun/alibabacloud-oss-go-sdk-v2/oss"
	"net"
)

// Do not log raw SDK errors: they can include signed URLs and credentials.
func taskErrorCategory(err error) string {
	var remote *oss.ServiceError
	if errors.As(err, &remote) {
		return fmt.Sprintf("oss:%s http:%d request:%s", remote.Code, remote.StatusCode, remote.RequestID)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "timeout"
	}
	if errors.Is(err, context.Canceled) {
		return "canceled"
	}
	var network net.Error
	if errors.As(err, &network) {
		if network.Timeout() {
			return "network_timeout"
		}
		return "network"
	}
	var safe interface{ SafeMessage() string }
	if errors.As(err, &safe) {
		return safe.SafeMessage()
	}
	return fmt.Sprintf("internal:%T", err)
}
