const app = Vue.createApp({
    data() {
        return {
            isSignup: false, // Controls slider (true = signup, false = signin)
            signin: { username: '', password: '' },
            signup: { username: '', email: '', password: '', confirmPassword: '' }
        };
    },
    methods: {
        toggleForm(isSignup) {
            this.isSignup = isSignup;
        },
        handleSignUp() {
            if (this.signup.password !== this.signup.confirmPassword) {
                alert('Passwords do not match!');
                return;
            }
            console.log('Sign Up:', this.signup);
            
            // Fake save user
            localStorage.setItem('currentUser', this.signup.username);
            
            // Always go to semester after signup
            window.location.href = './semester.html';
        },

        handleSignIn() {
            console.log('Sign In:', this.signin);
            
            // Fake login
            localStorage.setItem('currentUser', this.signin.username);
            
            // Check if semester is set
            const semester = localStorage.getItem('semester');
            if (!semester) {
                window.location.href = './semester.html';
            } else {
                window.location.href = './dashboard.html';
            }
        }
    }
}).mount('#app');