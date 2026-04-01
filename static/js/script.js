import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, signInWithPopup, signOut, GoogleAuthProvider, onAuthStateChanged, browserLocalPersistence, browserSessionPersistence, setPersistence, deleteUser, reauthenticateWithPopup } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, query, orderBy, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyDT-5DXoAHHhZDZEjk2V1Iz20sM62JD6so",
  authDomain: "shaurya-noob.firebaseapp.com",
  projectId: "shaurya-noob",
  storageBucket: "shaurya-noob.firebasestorage.app",
  messagingSenderId: "711818029705",
  appId: "1:711818029705:web:026c440c7b17b021f63458",
  measurementId: "G-FRXXKEPHNK"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

let currentUser = null;

// Auth persistence is now set dynamically based on Remember Me checkbox upon login

// Firestore helpers
async function saveProfile(uid, metrics, planText) {
    await setDoc(doc(db, "users", uid), {
        ...metrics,
        plan_text: planText,
        updated_at: new Date().toISOString()
    }, { merge: true });
}

async function loadProfile(uid) {
    const snap = await getDoc(doc(db, "users", uid));
    return snap.exists() ? snap.data() : null;
}

async function saveChatMessage(uid, sender, text) {
    await addDoc(collection(db, "users", uid, "chats"), {
        sender: sender,
        text: text,
        timestamp: new Date().toISOString()
    });
}

async function loadChatHistory(uid) {
    const q = query(collection(db, "users", uid, "chats"), orderBy("timestamp", "asc"));
    const snap = await getDocs(q);
    const messages = [];
    snap.forEach(doc => messages.push(doc.data()));
    return messages;
}

document.addEventListener('DOMContentLoaded', () => {
    const formMetrics = document.getElementById('metrics-form');
    const inputChat = document.getElementById('chat-input');
    const btnSend = document.getElementById('btn-send');
    const chatBox = document.getElementById('chat-box');

    // Plan-type toggle
    document.querySelectorAll('.toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('input-plan-type').value = btn.dataset.value;
        });
    });

    // Lightbox Logic
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxClose = document.getElementById('lightbox-close');

    function closeLightbox() {
        lightbox.classList.remove('active');
    }

    lightboxClose.addEventListener('click', closeLightbox);
    lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) closeLightbox();
    });
    
    // Listen for image clicks on dynamically generated content
    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('exercise-img') || e.target.classList.contains('exercise-img-wrapper')) {
            const imgEl = e.target.tagName === 'IMG' ? e.target : e.target.querySelector('img');
            if (imgEl && imgEl.src) {
                lightboxImg.src = imgEl.src;
                lightbox.classList.add('active');
            }
        }
    });

    // Auto-login check — fires if browser remembers the session
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            const profile = await loadProfile(user.uid);
            if (profile && profile.plan_text) {
                showScreen('chat');
                // Load all previous chat messages
                const history = await loadChatHistory(user.uid);
                if (history.length > 0) {
                    history.forEach(msg => addMessage(msg.sender, msg.text, false));
                } else {
                    addMessage('ai', `Welcome back, ${user.displayName}!\n\nHere is your saved plan:\n\n${profile.plan_text}`, false);
                }
            } else {
                showScreen('questionnaire');
            }
        }
    });

    document.getElementById('btn-google-login').addEventListener('click', async () => {
        try {
            const rememberMe = document.getElementById('remember-me').checked;
            const persistenceType = rememberMe ? browserLocalPersistence : browserSessionPersistence;
            await setPersistence(auth, persistenceType);
            
            const result = await signInWithPopup(auth, provider);
            currentUser = result.user;
            const profile = await loadProfile(currentUser.uid);
            if (profile && profile.plan_text) {
                showScreen('chat');
                const history = await loadChatHistory(currentUser.uid);
                if (history.length > 0) {
                    history.forEach(msg => addMessage(msg.sender, msg.text, false));
                } else {
                    addMessage('ai', `Welcome back, ${currentUser.displayName}!\n\nHere is your saved plan:\n\n${profile.plan_text}`, false);
                }
            } else {
                showScreen('questionnaire');
            }
        } catch (error) {
            console.error("Sign in error", error);
            alert("Sign in failed: " + error.message);
        }
    });

    // Sign Out
    document.getElementById('btn-signout').addEventListener('click', async () => {
        await signOut(auth);
        currentUser = null;
        chatBox.innerHTML = '';
        showScreen('welcome');
    });

    // Clear Chat & Reset
    document.getElementById('btn-clear-chat').addEventListener('click', async () => {
        if (!currentUser) return;
        if (!confirm('Are you sure you want to clear your plan & chat history?')) return;
        
        showScreen('loading');
        chatBox.innerHTML = '';
        
        try {
            // Delete profile plan
            await setDoc(doc(db, "users", currentUser.uid), { plan_text: null }, { merge: true });
            
            // Delete subcollection messages
            const q = query(collection(db, "users", currentUser.uid, "chats"));
            const snap = await getDocs(q);
            const deletions = [];
            snap.forEach(d => deletions.push(deleteDoc(d.ref)));
            await Promise.all(deletions);
            
            showScreen('questionnaire');
        } catch (error) {
            console.error("Clear chat error", error);
            showScreen('chat'); // fallback
        }
    });

    // Delete Account
    document.getElementById('btn-delete-account').addEventListener('click', async () => {
        if (!currentUser) return;
        if (!confirm('Are you ABSOLUTELY sure you want to delete your account? All data will be wiped permanently.')) return;
        
        try {
            // Re-authenticate first to satisfy Firebase's recent-login requirement
            await reauthenticateWithPopup(currentUser, provider);
            
            // Delete all Firestore data
            const chatsQuery = query(collection(db, "users", currentUser.uid, "chats"));
            const chatsSnap = await getDocs(chatsQuery);
            const deletions = [];
            chatsSnap.forEach(d => deletions.push(deleteDoc(d.ref)));
            await Promise.all(deletions);
            await deleteDoc(doc(db, "users", currentUser.uid));
            
            // Now delete the Auth user
            await deleteUser(currentUser);
            currentUser = null;
            chatBox.innerHTML = '';
            showScreen('welcome');
        } catch (error) {
            if (error.code === 'auth/popup-closed-by-user') {
                // User cancelled — do nothing
            } else {
                alert("Error deleting account: " + error.message);
            }
        }
    });

    function showScreen(screenName) {
        const screens = {
            welcome: document.getElementById('welcome-screen'),
            questionnaire: document.getElementById('questionnaire-screen'),
            loading: document.getElementById('loading-screen'),
            chat: document.getElementById('chat-screen')
        };
        Object.keys(screens).forEach(key => {
            if (key === screenName) {
                screens[key].className = 'screen active';
            } else if (screens[key].classList.contains('active')) {
                screens[key].className = 'screen prev';
            } else {
                screens[key].className = 'screen';
            }
        });
    }

    window.showScreen = showScreen;

    window.currentPlanDay = 1;
    window.maxPlanDays = 1;

    formMetrics.addEventListener('submit', async (e) => {
        e.preventDefault();
        showScreen('loading');

        const planType = document.getElementById('input-plan-type').value;
        const daysString = document.getElementById('input-days').value || "1";
        const match = daysString.match(/(\d+)/g);
        window.maxPlanDays = match ? parseInt(match[match.length - 1], 10) : 1;
        window.currentPlanDay = 1;
        
        const metrics = {
            basic: document.getElementById('input-basic').value,
            goal: document.getElementById('input-goal').value,
            diet: document.getElementById('input-diet').value,
            activity: document.getElementById('input-activity').value,
            experience: document.getElementById('input-experience').value,
            days: document.getElementById('input-days').value,
            duration: document.getElementById('input-duration').value,
            equipment: document.getElementById('input-equipment').value,
            health: document.getElementById('input-health').value
        };

        try {
            const response = await fetch('/api/generate_plan', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ metrics, plan_type: planType, uid: currentUser ? currentUser.uid : 'anonymous' })
            });
            const data = await response.json();
            
            if (response.ok) {
                if (currentUser) {
                    await saveProfile(currentUser.uid, metrics, data.plan);
                    await saveChatMessage(currentUser.uid, 'ai', data.plan);
                }
                showScreen('chat');
                addMessage('ai', data.plan, false);
            } else {
                showScreen('chat');
                addMessage('ai', "Error connecting to AI: " + (data.error || "Unknown"), false);
            }
        } catch (error) {
            showScreen('chat');
            addMessage('ai', "Error connecting to AI: " + error.message, false);
        }
    });

    function parseMarkdown(text) {
        let html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        // Headers: any line starting with one or more # (with or without space after)
        html = html.replace(/^#{1,6}\s*(.+)$/gm, '<strong class="section-header">$1</strong>');
        // Bold: **text**
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Italic: *text*
        html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
        // Bullet points: - at start of line
        html = html.replace(/^- (.+)$/gm, '• $1');
        // Horizontal rule: --- on its own line
        html = html.replace(/^-{3,}$/gm, '<hr class="chat-divider">');
        return html;
    }
    function renderWorkoutPlan(plan) {
        let html = '';
        
        // 1. Intro Section
        if (plan.intro) {
            html += `<div class="workout-intro-card">
                        <p>${plan.intro}</p>
                     </div>`;
        }

        // 2. Nutrition Section
        if (plan.nutrition) {
            html += `<div class="workout-nutrition-card">
                        <div class="nutrition-header">🥗 Nutrition Strategy</div>
                        <p>${plan.nutrition}</p>
                     </div>`;
        }
        
        // 3. Exercises Section (Handle both direct 'exercises' or nested 'days')
        let daysToRender = [];
        if (plan.days && Array.isArray(plan.days)) {
            daysToRender = plan.days;
        } else if (plan.exercises && Array.isArray(plan.exercises)) {
            daysToRender = [{
                day: plan.day || 'Day 1',
                focus: plan.focus || 'Main Workout',
                exercises: plan.exercises
            }];
        }

        daysToRender.forEach((dayObj, dayIdx) => {
            html += `<div class="day-section">
                        <div class="day-title">${dayObj.day || 'Workout'} - ${dayObj.focus || 'Focus'}</div>
                        <div class="exercise-list">`;
            
            if (dayObj.exercises && Array.isArray(dayObj.exercises)) {
                dayObj.exercises.forEach((ex, exIdx) => {
                    let imgUrl = ex.gif_url || ""; // Empty if not found in dictionary
                    let imgHtml = "";
                    if (imgUrl) {
                        imgHtml = `
                        <div class="exercise-img-wrapper">
                            <img src="${imgUrl}" alt="${ex.name}" class="exercise-img" loading="lazy">
                        </div>`;
                    }
                    
                    html += `
                    <div class="exercise-card">
                        ${imgHtml}
                        <div class="exercise-info">
                            <h4>${ex.name}</h4>
                            <p class="exercise-desc">${ex.description || ''}</p>
                            <div class="exercise-meta">
                                <span class="badge">${ex.sets || 3} Sets × ${ex.reps || '10-12'} Reps</span>
                            </div>
                        </div>
                    </div>`;
                });
            }
            
            html += `   </div>
                    </div>`;
        });
        
        let currentGeneratedDay = 1;
        if (plan.day) {
            const match = plan.day.match(/(\d+)/);
            if (match) currentGeneratedDay = parseInt(match[1], 10);
        } else if (plan.days && plan.days.length > 0) {
            const match = plan.days[plan.days.length - 1].day.match(/(\d+)/);
            if (match) currentGeneratedDay = parseInt(match[1], 10);
        }

        if (window.maxPlanDays && window.maxPlanDays > 1 && currentGeneratedDay < window.maxPlanDays) {
            html += `<div style="margin-top: 20px; text-align: center; color: var(--accent-color); font-weight: 600; font-size: 0.95rem;">
                        👉 Write "Day ${currentGeneratedDay + 1}" if you want me to give Day ${currentGeneratedDay + 1}!
                     </div>`;
        }
        
        return html;
    }

    function addMessage(sender, text, save = true) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${sender}`;
        
        // Add Avatar
        const avatar = document.createElement('span');
        avatar.className = 'avatar-icon';
        avatar.textContent = sender === 'ai' ? '🤖 FitConnect AI' : '👤 You';
        msgDiv.appendChild(avatar);

        const contentDiv = document.createElement('div');
        contentDiv.className = 'message-content';

        if (sender === 'ai') {
            try {
                let cleanText = text.trim();
                const startIdx = cleanText.indexOf('{');
                const endIdx = cleanText.lastIndexOf('}');
                
                if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
                    const jsonCandidate = cleanText.substring(startIdx, endIdx + 1);
                    const planObj = JSON.parse(jsonCandidate);
                    
                    if (planObj && planObj.exercises && Array.isArray(planObj.exercises)) {
                        contentDiv.innerHTML = renderWorkoutPlan(planObj);
                        msgDiv.style.maxWidth = '100%'; // Cards need more room
                    } else if (planObj.days) {
                         contentDiv.innerHTML = renderWorkoutPlan(planObj);
                         msgDiv.style.maxWidth = '100%';
                    } else {
                        contentDiv.innerHTML = parseMarkdown(text);
                    }
                } else {
                    contentDiv.innerHTML = parseMarkdown(text);
                }
            } catch (e) {
                contentDiv.innerHTML = parseMarkdown(text);
            }
            
            msgDiv.appendChild(contentDiv);



        } else {
            contentDiv.textContent = text;
            msgDiv.appendChild(contentDiv);
        }
        
        chatBox.appendChild(msgDiv);
        
        // 2) Top of Message Auto-Scroll
        if (sender === 'ai') {
            setTimeout(() => {
                msgDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 50);
        } else {
            chatBox.scrollTop = chatBox.scrollHeight;
        }

        if (save && currentUser) {
            saveChatMessage(currentUser.uid, sender, text);
        }
    }

    window.addMessage = addMessage;

    async function sendMessage() {
        const text = inputChat.value.trim();
        if (!text) return;

        addMessage('user', text, true);
        inputChat.value = '';
        
        const typingDiv = document.createElement('div');
        typingDiv.className = 'message ai typing';
        typingDiv.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
        chatBox.appendChild(typingDiv);
        chatBox.scrollTop = chatBox.scrollHeight;

        let planText = '';
        if (currentUser) {
            const profile = await loadProfile(currentUser.uid);
            if (profile) planText = profile.plan_text || '';
        }

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    message: text, 
                    uid: currentUser ? currentUser.uid : 'anonymous',
                    plan_text: planText
                })
            });
            const data = await response.json();
            
            chatBox.removeChild(typingDiv);
            if (response.ok) {
                addMessage('ai', data.response, true);
            } else {
                addMessage('ai', "Error connecting to AI: " + (data.error || "Unknown"), false);
            }
        } catch (error) {
            chatBox.removeChild(typingDiv);
            addMessage('ai', "Error connecting to AI: " + error.message, false);
        }
    }

    btnSend.addEventListener('click', sendMessage);
    inputChat.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });
});
