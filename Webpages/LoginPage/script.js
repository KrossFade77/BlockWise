import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyBEuPV6piBqzJbl-gXZOt_YIS0F2cGIk00",
    authDomain: "testbase-ca192.firebaseapp.com",
    projectId: "testbase-ca192",
    storageBucket: "testbase-ca192.firebasestorage.app",
    messagingSenderId: "344945139722",
    appId: "1:344945139722:web:75aa2e9a5a364de11c3ff3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app, "blockwise");

const { createApp } = Vue;

createApp({
    data() {
        return {
            isSignup: false,
            signin: { email: '', password: '' },
            signup: { email: '', password: '', confirmPassword: '' },
            loading: false,
            error: ''
        };
    },
    methods: {
        toggleForm(isSignup) {
            this.isSignup = isSignup;
            this.error = '';
        },
        async handleSignUp() {
            // Trim whitespace
            const email = this.signup.email.trim();
            const password = this.signup.password;
            const confirm = this.signup.confirmPassword;

            if (!email || !password || !confirm) {
                this.error = 'All fields are required.';
                return;
            }
            if (password !== confirm) {
                this.error = 'Passwords do not match!';
                return;
            }
            if (password.length < 6) {
                this.error = 'Password must be at least 6 characters.';
                return;
            }
            if (!/^\S+@\S+\.\S+$/.test(email)) {
                this.error = 'Please enter a valid email.';
                return;
            }

            this.loading = true;
            this.error = '';
            try {
                const userCredential = await createUserWithEmailAndPassword(auth, email, password);
                console.log("Signed up:", userCredential.user.email);
                window.location.href = '../semester.html';
            } catch (error) {
                console.error("Sign up error:", error);
                this.error = error.message || 'Sign up failed. Try again.';
            } finally {
                this.loading = false;
            }
        },
        async handleSignIn() {
            const email = this.signin.email.trim();
            const password = this.signin.password;

            if (!email || !password) {
                this.error = 'Email and password required.';
                return;
            }

            this.loading = true;
            this.error = '';
            try {
                const userCredential = await signInWithEmailAndPassword(auth, email, password);
                console.log("Signed in:", userCredential.user.email);
                const semesterDoc = await getDoc(doc(db, userCredential.user.uid, "semester"));
                window.location.href = semesterDoc.exists() ? '../dashboard.html' : '../semester.html';
            } catch (error) {
                console.error("Sign in error:", error);
                this.error = error.message || 'Login failed.';
            } finally {
                this.loading = false;
            }
        }
    },
    mounted() {
        onAuthStateChanged(auth, (user) => {
            if (user && window.location.pathname.includes('LoginPage')) {
                // Already logged in → redirect
                getDoc(doc(db, user.uid, "semester")).then(snap => {
                    if (snap.exists()) {
                        window.location.href = '../dashboard.html';
                    } else {
                        window.location.href = '../semester.html';
                    }
                });
            }
        });
    }
}).mount('#app');