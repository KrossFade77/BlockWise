import { initializeApp } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged, signOut, GoogleAuthProvider, signInWithPopup } from "https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js";
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
                window.location.href = './semester.html';
            } catch (error) {
                console.error("Sign up error:", error);
                this.error = this.getFriendlyError(error);
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
                window.location.href = semesterDoc.exists() ? './dashboard.html' : './semester.html';
            } catch (error) {
                console.error("Sign in error:", error);
                this.error = this.getFriendlyError(error);
            } finally {
                this.loading = false;
            }
        },

        getFriendlyError(error) {
            switch (error.code) {
                case 'auth/user-not-found':
                case 'auth/wrong-password':
                    return 'Invalid email or password.';
                case 'auth/invalid-email':
                    return 'Please enter a valid email address.';
                case 'auth/email-already-in-use':
                    return 'This email is already registered. Please sign in.';
                case 'auth/weak-password':
                    return 'Password must be at least 6 characters long.';
                default:
                    return error.message || 'An unknown error occurred.';
            }
        },

        async handleGoogleSignIn() {
            console.log("[DEBUG] handleGoogleSignIn called.");
            this.loading = true;
            this.error = '';

            const provider = new GoogleAuthProvider(); // Create the Google provider

            try {
                // 1. Trigger the Google Sign-In popup
                const userCredential = await signInWithPopup(auth, provider);
                const user = userCredential.user;
                console.log("[DEBUG] Google Sign-In successful:", user.email);

                // 2. Check if they have a semester doc (just like in normal sign-in)
                const semesterDoc = await getDoc(doc(db, user.uid, "semester"));

                // 3. Redirect to the correct page
                if (semesterDoc.exists()) {
                    console.log("[DEBUG] Semester doc found. Redirecting to dashboard.");
                    window.location.href = './dashboard.html';
                } else {
                    console.log("[DEBUG] No semester doc. Redirecting to semester setup.");
                    window.location.href = './semester.html';
                }

            } catch (error) {
                console.error("[DEBUG] Google Sign-in error:", error);
                this.error = this.getFriendlyError(error); // Show a friendly error

            } finally {
                this.loading = false;
            }
        },

        hidePreloader() {
            const preloader = document.getElementById('preloader');
            if (preloader) {
                // Fade it out
                preloader.style.opacity = '0';
                setTimeout(() => {
                    // Hide it completely after the fade
                    preloader.style.display = 'none';
                }, 500); // 500ms matches the CSS transition
            }
        },
    },
    mounted() {
        onAuthStateChanged(auth, (user) => {
            if (user && (window.location.pathname.includes('index.html') || window.location.pathname === '/')) {
                // User is logged in, just redirect.
                // The preloader will stay visible until the new page loads.
                getDoc(doc(db, user.uid, "semester")).then(snap => {
                    if (snap.exists()) {
                        window.location.href = './dashboard.html';
                    } else {
                        window.location.href = './semester.html';
                    }
                });
            } else {
                // No user is logged in, so hide the preloader
                // and show the login form.
                this.hidePreloader();
            }
        });
    }
}).mount('#app');