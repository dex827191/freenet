package main

import (
	"bytes"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"strings"
	"time"
)

const (
	WSMagic             = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
	ProxyConfigFile     = "/tmp/ws_proxy_config.json"
	DefaultMaxBuffer    = 32 * 1024
	DefaultKeepAlive    = 15000
	DefaultSshPort      = 22
	DefaultWSListenPort = "8880"
	HeaderReadLimit     = 32 * 1024
	HeaderReadTimeout   = 10 * time.Second
	ProbeTimeout        = 500 * time.Millisecond
)

type ProxyConfig struct {
	SshPort   int `json:"sshPort"`
	KeepAlive int `json:"keepAlive"`
	MaxBuffer int `json:"maxBuffer"`
}

// 🔍 Baca config dinamis dari file JSON (fallback ke default kalau gagal)
func getProxyConfig() ProxyConfig {
	cfg := ProxyConfig{
		SshPort:   DefaultSshPort,
		KeepAlive: DefaultKeepAlive,
		MaxBuffer: DefaultMaxBuffer,
	}
	if data, err := os.ReadFile(ProxyConfigFile); err == nil {
		_ = json.Unmarshal(data, &cfg)
	}
	if cfg.SshPort <= 0 {
		cfg.SshPort = DefaultSshPort
	}
	if cfg.KeepAlive <= 0 {
		cfg.KeepAlive = DefaultKeepAlive
	}
	if cfg.MaxBuffer <= 0 {
		cfg.MaxBuffer = DefaultMaxBuffer
	}
	return cfg
}

func tweakSocket(conn net.Conn, keepAliveMs int) {
	if tcp, ok := conn.(*net.TCPConn); ok {
		_ = tcp.SetNoDelay(true)
		_ = tcp.SetKeepAlive(true)
		if keepAliveMs > 0 {
			_ = tcp.SetKeepAlivePeriod(time.Duration(keepAliveMs) * time.Millisecond)
		}
		_ = tcp.SetReadBuffer(512 * 1024)
		_ = tcp.SetWriteBuffer(512 * 1024)
	}
}

func parseHeaders(raw string) map[string]string {
	headers := make(map[string]string)
	lines := strings.Split(raw, "\r\n")
	for i := 1; i < len(lines); i++ {
		line := lines[i]
		if idx := strings.Index(line, ":"); idx != -1 {
			k := strings.ToLower(strings.TrimSpace(line[:idx]))
			v := strings.TrimSpace(line[idx+1:])
			headers[k] = v
		}
	}
	return headers
}

// readHttpHeaders mendukung 3 format:
//  1. HTTP standar (akhir header: \r\n\r\n)
//  2. WebSocket sederhana dengan [crlf] (akhir: [crlf][crlf])
//  3. Pylod Enhanced (decoy + WS + [split] + fake response)
func readHttpHeaders(conn net.Conn) (string, []byte, error) {
	_ = conn.SetReadDeadline(time.Now().Add(HeaderReadTimeout))
	defer conn.SetReadDeadline(time.Time{})

	var buf []byte
	tmp := make([]byte, 4096)
	wsMarkerEnd := -1
	probed := false

	for {
		n, err := conn.Read(tmp)
		if n > 0 {
			buf = append(buf, tmp[:n]...)
			probed = false

			// PRIORITAS 1: [split] = penanda akhir payload Pylod Enhanced
			if idx := bytes.Index(buf, []byte("[split]")); idx != -1 {
				return string(buf[:idx]), buf[idx+len("[split]"):], nil
			}

			// Deteksi marker WS upgrade
			if wsMarkerEnd == -1 {
				bufLower := bytes.ToLower(buf)
				if idx := bytes.Index(bufLower, []byte("upgrade:websocket")); idx != -1 {
					wsMarkerEnd = idx + len("upgrade:websocket")
				} else if idx := bytes.Index(bufLower, []byte("upgrade: websocket")); idx != -1 {
					wsMarkerEnd = idx + len("upgrade: websocket")
				}
			}

			if wsMarkerEnd != -1 {
				// PRIORITAS 2: header end SETELAH marker WS (hindari decoy)
				if subIdx := bytes.Index(buf[wsMarkerEnd:], []byte("[crlf][crlf]")); subIdx != -1 {
					end := wsMarkerEnd + subIdx + len("[crlf][crlf]")
					return string(buf[:end]), buf[end:], nil
				}
				if subIdx := bytes.Index(buf[wsMarkerEnd:], []byte("\r\n\r\n")); subIdx != -1 {
					end := wsMarkerEnd + subIdx + 4
					return string(buf[:end]), buf[end:], nil
				}
			} else {
				// PRIORITAS 3: tanpa WS marker
				hasCrlf := bytes.Contains(buf, []byte("[crlf]"))
				if !hasCrlf {
					if idx := bytes.Index(buf, []byte("\r\n\r\n")); idx != -1 {
						return string(buf[:idx+4]), buf[idx+4:], nil
					}
				} else if !probed {
					// Ada [crlf] tapi belum ada WS marker → probe data tambahan
					if lastIdx := bytes.LastIndex(buf, []byte("[crlf][crlf]")); lastIdx != -1 {
						probed = true
						_ = conn.SetReadDeadline(time.Now().Add(ProbeTimeout))
						n2, err2 := conn.Read(tmp)
						_ = conn.SetReadDeadline(time.Now().Add(HeaderReadTimeout))
						if n2 > 0 {
							buf = append(buf, tmp[:n2]...)
							probed = false
							continue
						}
						if err2 != nil {
							end := lastIdx + len("[crlf][crlf]")
							return string(buf[:end]), buf[end:], nil
						}
					}
				}
			}

			if len(buf) > HeaderReadLimit {
				return "", nil, fmt.Errorf("header too large")
			}
		}
		if err != nil {
			if len(buf) > 0 {
				return string(buf), nil, nil
			}
			return "", nil, err
		}
	}
}

func genWsKey() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return base64.StdEncoding.EncodeToString(b)
}

// normalizeRequest: [crlf] -> \r\n, buang baris status kustom "HTTP/enhanced"
func normalizeRequest(raw string) string {
	normalized := strings.ReplaceAll(raw, "[crlf]", "\r\n")
	lines := strings.Split(normalized, "\r\n")
	filtered := make([]string, 0, len(lines))
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(trimmed), "http/enhanced") {
			continue
		}
		filtered = append(filtered, line)
	}
	return strings.Join(filtered, "\r\n")
}

// findWsRequest: dari stream yang berisi multiple HTTP request (decoy + WS),
// ambil blok yang mengandung "Upgrade: websocket"
func findWsRequest(raw string) string {
	rawLower := strings.ToLower(raw)
	if !strings.Contains(rawLower, "upgrade:websocket") && !strings.Contains(rawLower, "upgrade: websocket") {
		return raw
	}
	blocks := strings.Split(raw, "\r\n\r\n")
	for i := len(blocks) - 1; i >= 0; i-- {
		blockLower := strings.ToLower(blocks[i])
		if strings.Contains(blockLower, "upgrade:websocket") || strings.Contains(blockLower, "upgrade: websocket") {
			return blocks[i]
		}
	}
	return raw
}

func handleWS(client net.Conn, cfg ProxyConfig) {
	defer client.Close()
	tweakSocket(client, cfg.KeepAlive)

	rawHeaders, trailing, err := readHttpHeaders(client)
	if err != nil || rawHeaders == "" {
		return
	}

	// === SUPPORT PYLOD ENHANCED ===
	actualRequest := normalizeRequest(rawHeaders)
	actualRequest = findWsRequest(actualRequest)

	headers := parseHeaders(actualRequest)
	rawLower := strings.ToLower(actualRequest)
	isWsUpgrade := strings.Contains(rawLower, "upgrade:websocket") ||
		strings.Contains(rawLower, "upgrade: websocket")

	if isWsUpgrade {
		wsKey := headers["sec-websocket-key"]
		if wsKey == "" {
			wsKey = genWsKey()
		}
		h := sha1.Sum([]byte(wsKey + WSMagic))
		acceptKey := base64.StdEncoding.EncodeToString(h[:])

		var resp strings.Builder
		resp.WriteString("HTTP/1.1 101 Switching Protocols\r\n")
		resp.WriteString("Upgrade: websocket\r\n")
		resp.WriteString("Connection: Upgrade\r\n")
		resp.WriteString("Sec-WebSocket-Accept: " + acceptKey + "\r\n")
		if proto := headers["sec-websocket-protocol"]; proto != "" {
			resp.WriteString("Sec-WebSocket-Protocol: " + proto + "\r\n")
		}
		resp.WriteString("\r\n")
		if _, werr := client.Write([]byte(resp.String())); werr != nil {
			return
		}
	} else {
		defaultResp := os.Getenv("WS_RESPONSE")
		if defaultResp == "" {
			defaultResp = "HTTP/1.1 101 Switching Protocols\r\n\r\n"
		}
		if _, werr := client.Write([]byte(defaultResp)); werr != nil {
			return
		}
	}

	sshAddr := fmt.Sprintf("127.0.0.1:%d", cfg.SshPort)
	sshConn, err := net.DialTimeout("tcp", sshAddr, 5*time.Second)
	if err != nil {
		log.Printf("[WS] Gagal connect ke SSH %s: %v", sshAddr, err)
		return
	}
	defer sshConn.Close()
	tweakSocket(sshConn, cfg.KeepAlive)

	// Preserve trailing bytes; buang fake HTTP response dari Pylod Enhanced
	pending := make([]byte, 0, cfg.MaxBuffer)
	if len(trailing) > 0 {
		trailingNorm := strings.ReplaceAll(string(trailing), "[crlf]", "\r\n")
		trimmed := strings.TrimSpace(trailingNorm)
		// Fake response seperti "HTTP/enhanced 200 Ok" harus dibuang
		if !strings.HasPrefix(strings.ToUpper(trimmed), "HTTP/") {
			pending = append(pending, trailing...)
		}
	}

	done := make(chan struct{}, 2)

	// Client -> SSH (filter "SSH-", tahan split antar paket)
	go func() {
		defer func() { done <- struct{}{} }()
		buf := make([]byte, 64*1024)
		handshakeDone := false

		// FASE 1: akumulasi sampai ketemu "SSH-" (tahan split antar paket)
		for !handshakeDone {
			if idx := bytes.Index(pending, []byte("SSH-")); idx != -1 {
				if _, werr := sshConn.Write(pending[idx:]); werr != nil {
					return
				}
				handshakeDone = true
				pending = nil
				break
			}
			if len(pending) > cfg.MaxBuffer {
				log.Printf("[WS] Buffer limit (%d) terlampaui sebelum SSH-, disconnect", cfg.MaxBuffer)
				return
			}
			n, rerr := client.Read(buf)
			if n > 0 {
				pending = append(pending, buf[:n]...)
			}
			if rerr != nil {
				return
			}
		}

		// FASE 2: pure piping (mode los)
		for {
			n, rerr := client.Read(buf)
			if n > 0 {
				if _, werr := sshConn.Write(buf[:n]); werr != nil {
					return
				}
			}
			if rerr != nil {
				return
			}
		}
	}()

	// SSH -> Client
	go func() {
		defer func() { done <- struct{}{} }()
		buf := make([]byte, 64*1024)
		for {
			n, rerr := sshConn.Read(buf)
			if n > 0 {
				if _, werr := client.Write(buf[:n]); werr != nil {
					return
				}
			}
			if rerr != nil {
				return
			}
		}
	}()

	<-done
}

func main() {
	wsPort := os.Getenv("WS_PORT")
	if wsPort == "" {
		wsPort = DefaultWSListenPort
	}
	bindHost := os.Getenv("WS_BIND")
	if bindHost == "" {
		bindHost = "127.0.0.1" // internal, hanya bisa diakses muxer (aman)
	}

	listener, err := net.Listen("tcp", bindHost+":"+wsPort)
	if err != nil {
		log.Fatalf("[WS] Gagal listen %s:%s: %v", bindHost, wsPort, err)
	}
	defer listener.Close()

	log.Printf("[WS Engine Go] Listen %s:%s -> SSH dynamic (config: %s)", bindHost, wsPort, ProxyConfigFile)

	for {
		conn, err := listener.Accept()
		if err != nil {
			continue
		}
		cfg := getProxyConfig() // reload tiap koneksi → hot reload dari UI
		go handleWS(conn, cfg)
	}
}
