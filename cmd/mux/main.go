package main

import (
	"bufio"
	"io"
	"log"
	"net"
	"os"
	"time"
)

const (
	TLSHandshakeByte = 0x16
	SocketBuffer     = 512 * 1024
	PeekTimeout      = 5 * time.Second
	DialTimeout      = 5 * time.Second
)

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func tweakSocket(conn net.Conn) {
	if tcp, ok := conn.(*net.TCPConn); ok {
		_ = tcp.SetNoDelay(true)
		_ = tcp.SetKeepAlive(true)
		_ = tcp.SetKeepAlivePeriod(10 * time.Second)
		_ = tcp.SetReadBuffer(SocketBuffer)
		_ = tcp.SetWriteBuffer(SocketBuffer)
	}
}

func handleClient(client net.Conn, sslTarget, wsTarget string) {
	defer client.Close()
	tweakSocket(client)

	reader := bufio.NewReaderSize(client, 4096)

	// Anti-slowloris: client wajib kirim byte pertama dalam 5 detik
	_ = client.SetReadDeadline(time.Now().Add(PeekTimeout))
	peeked, err := reader.Peek(1)
	_ = client.SetReadDeadline(time.Time{})
	if err != nil || len(peeked) == 0 {
		return
	}

	var targetAddr, label string
	if peeked[0] == TLSHandshakeByte {
		targetAddr, label = sslTarget, "SSL/Stunnel"
	} else {
		targetAddr, label = wsTarget, "WS-Proxy"
	}

	backend, err := net.DialTimeout("tcp", targetAddr, DialTimeout)
	if err != nil {
		log.Printf("[Mux] Gagal dial %s (%s): %v", targetAddr, label, err)
		return
	}
	defer backend.Close()
	tweakSocket(backend)

	done := make(chan struct{}, 2)

	go func() {
		defer func() { done <- struct{}{} }()
		buf := make([]byte, SocketBuffer)
		_, _ = io.CopyBuffer(backend, reader, buf)
	}()
	go func() {
		defer func() { done <- struct{}{} }()
		buf := make([]byte, SocketBuffer)
		_, _ = io.CopyBuffer(client, backend, buf)
	}()

	<-done
}

func main() {
	publicPort := getEnv("PORT", getEnv("MUX_PORT", "8881"))

	sslHost := getEnv("SSL_TARGET_HOST", "127.0.0.1")
	sslPort := getEnv("SSL_TARGET_PORT", "2443")
	sslTarget := sslHost + ":" + sslPort

	wsHost := getEnv("WS_MUX_TARGET_HOST", "127.0.0.1")
	wsPort := getEnv("WS_MUX_TARGET_PORT", "8880")
	wsTarget := wsHost + ":" + wsPort

	listener, err := net.Listen("tcp", "0.0.0.0:"+publicPort)
	if err != nil {
		log.Fatalf("[Mux] Gagal listen 0.0.0.0:%s: %v", publicPort, err)
	}
	defer listener.Close()

	log.Printf("[Mux Go] Listen 0.0.0.0:%s -> SSL:%s | WS:%s", publicPort, sslTarget, wsTarget)

	for {
		conn, err := listener.Accept()
		if err != nil {
			continue
		}
		go handleClient(conn, sslTarget, wsTarget)
	}
}
