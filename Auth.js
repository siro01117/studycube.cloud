// Auth.js: 외부 의존성 없는 독립형 보안 시스템
window.AuthSystem = {
    ACCESS_PW: "R040117!",
    
    renderGate: (setIsAuth) => {
        const [displayValue, setDisplayValue] = React.useState(""); // 화면 노출용 (● + 마지막 글자)
        const [realValue, setRealValue] = React.useState("");       // 실제 비밀번호 데이터
        const timerRef = React.useRef(null);

        // [내부 전용 스타일 주입]
        React.useEffect(() => {
            const styleId = 'auth-internal-style';
            if (!document.getElementById(styleId)) {
                const style = document.createElement('style');
                style.id = styleId;
                style.innerHTML = `
                    @keyframes authSlideUp {
                        from { opacity: 0; transform: translateY(30px) scale(0.95); }
                        to { opacity: 1; transform: translateY(0) scale(1); }
                    }
                    .auth-card { animation: authSlideUp 0.6s cubic-bezier(0.16, 1, 0.3, 1); }
                    .auth-input::placeholder { color: #cbd5e1 !important; opacity: 1; }
                    .auth-input:focus { border-color: #2563eb !important; background: #ffffff !important; }
                `;
                document.head.appendChild(style);
            }
        }, []);

        const handleInput = (e) => {
            const val = e.target.value;
            
            // 1. 삭제 처리
            if (val.length < realValue.length) {
                const newReal = realValue.slice(0, val.length);
                setRealValue(newReal);
                setDisplayValue("●".repeat(newReal.length));
                return;
            }

            // 2. 신규 글자 추가
            const char = val.slice(-1);
            const newReal = realValue + char;
            setRealValue(newReal);

            // 3. 지연 마스킹: 이전 글자들은 ●로, 마지막 글자만 노출
            const masked = "●".repeat(realValue.length) + char;
            setDisplayValue(masked);

            // 4. 타이머 설정: 0.7초 후 마지막 글자도 마스킹
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                setDisplayValue("●".repeat(newReal.length));
            }, 700);
        };

        const verify = () => {
            if (realValue === window.AuthSystem.ACCESS_PW) {
                setIsAuth(true);
            } else {
                alert("코드가 일치하지 않습니다.");
                setRealValue("");
                setDisplayValue("");
            }
        };

        return (
            <div style={{
                height: '100vh', width: '100vw', backgroundColor: '#1E1E22',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'fixed', top: 0, left: 0, zIndex: 9999, overflow: 'hidden'
            }}>
                <div className="auth-card" style={{
                    backgroundColor: '#ffffff', padding: '80px 60px', borderRadius: '80px',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)', textAlign: 'center',
                    maxWidth: '600px', width: '90%'
                }}>
                    
                    {/* 타이틀 영역 */}
                    <div style={{ marginBottom: '60px' }}>
                        <p style={{ 
                            color: '#cbd5e1', fontWeight: 900, letterSpacing: '0.4em', 
                            fontSize: '14px', marginBottom: '16px', fontStyle: 'italic' 
                        }}>SECURITY PROTOCOL</p>
                        <h1 style={{ 
                            fontSize: '42px', fontWeight: 900, color: '#1e293b', 
                            margin: 0, letterSpacing: '-0.02em' 
                        }}>접근 코드가 필요합니다</h1>
                    </div>

                    {/* 입력 영역 */}
                    <div style={{ position: 'relative', marginBottom: '40px' }}>
                        <input 
                            type="text" 
                            placeholder="Enter Code" 
                            autoFocus
                            value={displayValue}
                            onChange={handleInput}
                            onKeyDown={(e) => e.key === 'Enter' && verify()}
                            className="auth-input"
                            style={{
                                width: '100%', border: '6px solid #f1f5f9', padding: '35px',
                                borderRadius: '40px', textAlign: 'center', fontSize: '48px',
                                fontWeight: 900, backgroundColor: '#f8fafc', outline: 'none',
                                transition: 'all 0.3s ease', boxSizing: 'border-box'
                            }}
                        />
                    </div>

                    {/* 액션 버튼 */}
                    <button 
                        onClick={verify}
                        style={{
                            width: '100%', backgroundColor: '#0f172a', color: '#ffffff',
                            padding: '30px', borderRadius: '40px', fontSize: '24px',
                            fontWeight: 900, border: 'none', cursor: 'pointer',
                            boxShadow: '0 10px 20px rgba(0,0,0,0.2)', transition: 'transform 0.2s ease',
                            letterSpacing: '0.1em'
                        }}
                        onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.96)'}
                        onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    >
                        VERIFY SYSTEM
                    </button>

                    <p style={{ 
                        marginTop: '50px', color: '#94a3b8', fontSize: '12px', 
                        fontWeight: 700, letterSpacing: '0.5em', opacity: 0.6 
                    }}>STUDY CUBE PROTECTED AREA</p>
                </div>
            </div>
        );
    }
};
