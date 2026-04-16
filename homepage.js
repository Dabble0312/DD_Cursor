// homepage.js — Dashboard logic and navigation

// ── AUTH CHECK ──
// If no username is found, redirect to the login page immediately.
const username = localStorage.getItem("username");
if (!username) {
    window.location.href = "login.html";
} else {
    // Populate the user profile header
    document.getElementById("currentUsername").textContent = username;
}

// ── LOGOUT ──
document.getElementById("logoutBtn").addEventListener("click", () => {
    localStorage.removeItem("username");
    window.location.href = "login.html";
});

// ── SUPABASE / START GAME ──
document.getElementById("startBtn").addEventListener("click", async () => {
    try {
        // Create an anonymous session — provides a unique ID for the user
        const { data, error } = await supabase.auth.signInAnonymously();
        if (error) throw error;

        localStorage.setItem("supabase_user_id", data.user.id);
        console.log("Cloud Session Active:", data.user.id);
        window.location.href = "game.html";

    } catch (err) {
        // Fail-safe: if DB is unreachable, still let them play in Local Mode
        console.warn("Database connection failed. Starting in Local Mode.", err.message);
        window.location.href = "game.html";
    }
});

// ── NAVIGATION LISTENERS ──
document.getElementById("focusBtn").addEventListener("click", () => {
    window.location.href = "focus.html";
});

document.getElementById("tradingBtn").addEventListener("click", () => {
    window.location.href = "trading.html";
});

document.getElementById("learnBtn").addEventListener("click", () => {
    window.location.href = "learn.html";
});

document.getElementById("testBtn").addEventListener("click", () => {
    window.location.href = "test.html";
});