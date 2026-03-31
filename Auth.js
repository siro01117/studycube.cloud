// Auth.js
window.AuthSystem = {
    ACCESS_PW: "R040117!",
    check: (input) => input === window.AuthSystem.ACCESS_PW,
    renderGate: (setIsAuth) => {
        const [pw, setPw] = React.useState("");
        return (
            <div className="h-screen w-full bg-[#1E1E22] flex items-center justify-center p-6">
                <div className="bg-white p-20 rounded-[5rem] shadow-2xl text-center max-w-xl w-full">
                    <h2 className="text-2xl font-black mb-4 text-slate-300 italic">SECURITY GATE</h2>
                    <h1 className="text-4xl font-black mb-12">접근 코드가 필요합니다</h1>
                    <input 
                        type="password" 
                        placeholder="Enter Code" 
                        autoFocus
                        value={pw}
                        onChange={(e) => setPw(e.target.value)}
                        className="w-full border-4 border-slate-50 p-8 rounded-[2rem] text-center text-3xl font-black mb-10 bg-slate-50 outline-none focus:border-blue-500"
                        onKeyDown={(e) => e.key === 'Enter' && (window.AuthSystem.check(pw) ? setIsAuth(true) : alert("Wrong Code"))}
                    />
                    <button onClick={() => window.AuthSystem.check(pw) ? setIsAuth(true) : alert("Wrong Code")} className="w-full bg-slate-900 text-white py-8 rounded-[2rem] text-2xl font-black">VERIFY</button>
                </div>
            </div>
        );
    }
};
