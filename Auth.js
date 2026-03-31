// Auth.js: 보안 게이트웨이 시스템
window.AuthSystem = {
    ACCESS_PW: "R040117!",
    
    renderGate: (setIsAuth) => {
        const [displayValue, setDisplayValue] = React.useState(""); // 화면에 보여줄 문자열 (* 또는 실제글자)
        const [realValue, setRealValue] = React.useState("");       // 실제 저장된 비밀번호
        const timerRef = React.useRef(null);

        const handleInput = (e) => {
            const val = e.target.value;
            
            // 삭제 대응
            if (val.length < realValue.length) {
                const newReal = realValue.slice(0, val.length);
                setRealValue(newReal);
                setDisplayValue("●".repeat(newReal.length));
                return;
            }

            // 신규 글자 추출
            const char = val.slice(-1);
            const newReal = realValue + char;
            setRealValue(newReal);

            // 현재 글자 보여주기 로직: 이전 글자들은 가리고 마지막 글자만 노출
            const masked = "●".repeat(realValue.length) + char;
            setDisplayValue(masked);

            // 0.8초 후 마지막 글자도 가리기 (다음 글자 입력 시 즉시 가려짐)
            if (timerRef.current) clearTimeout(timerRef.current);
            timerRef.current = setTimeout(() => {
                setDisplayValue("●".repeat(newReal.length));
            }, 800);
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
            <div className="h-screen w-full bg-[#1E1E22] flex items-center justify-center p-6">
                <div className="bg-white p-12 lg:p-24 rounded-[5rem] shadow-2xl text-center max-w-2xl w-full modal-animate border border-white/10">
                    <div className="mb-10">
                        <div className="flex justify-center mb-6">
                            <div className="p-5 bg-slate-50 rounded-full shadow-inner">
                                <lucide.icons.Lock size={48} className="text-slate-800" />
                            </div>
                        </div>
                        <h2 className="text-2xl font-black mb-4 text-slate-300 uppercase tracking-[0.3em] italic">Security Protocol</h2>
                        <h1 className="text-5xl font-black text-slate-800 tracking-tighter">접근 코드가 필요합니다</h1>
                    </div>

                    <div className="relative group">
                        <input 
                            type="text" 
                            placeholder="Enter Code" 
                            autoFocus
                            value={displayValue}
                            onChange={handleInput}
                            className="w-full border-4 border-slate-100 p-10 rounded-[3rem] text-center text-5xl font-black mb-12 bg-slate-50 outline-none focus:border-blue-600 transition-all shadow-inner placeholder:text-slate-200"
                            onKeyDown={(e) => e.key === 'Enter' && verify()}
                        />
                        <div className="absolute inset-y-0 right-10 flex items-center mb-12">
                            <div className={`w-3 h-3 rounded-full transition-colors ${realValue.length > 0 ? 'bg-blue-500 animate-pulse' : 'bg-slate-200'}`}></div>
                        </div>
                    </div>

                    <button 
                        onClick={verify} 
                        className="w-full bg-slate-900 text-white py-10 rounded-[3rem] text-3xl font-black shadow-2xl active:scale-95 transition-all hover:bg-black uppercase tracking-widest"
                    >
                        Verify System
                    </button>
                    
                    <p className="mt-12 text-slate-300 font-bold uppercase tracking-[0.4em] text-sm italic">Study Cube Managed Session</p>
                </div>
            </div>
        );
    }
};
