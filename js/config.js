/* --- config.js --- */

// Configuração do Supabase
const SUPABASE_URL = 'https://vfnnznnjvlewrbfczczw.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmbm56bm5qdmxld3JiZmN6Y3p3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ2MTEyNDIsImV4cCI6MjA4MDE4NzI0Mn0.wwsfhzjauqM7V0VB93-TKH8-mVN11mBukhSFUlSHgtU';

// Inicializa o cliente globalmente
if (window.supabase) {
    window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} else {
    console.error("Supabase Library not loaded. Add the CDN script first.");
}

// Configuração do Tailwind (Opcional, se já não estiver no HTML)
if (window.tailwind) {
    window.tailwind.config = {
        darkMode: 'class', 
        theme: {
            extend: {
                fontFamily: {
                    sans: ['Inter', 'sans-serif'],
                    display: ['Outfit', 'sans-serif'],
                },
                colors: {
                    primary: '#1e293b',
                    brand: '#4f46e5',
                    brandLight: '#818cf8',
                    accent: '#06b6d4',
                },
                animation: {
                    'fade-in-up': 'fadeInUp 0.5s ease-out',
                }
            }
        }
    }
}

window.formatDateBR = (isoDate) => {
    if (!isoDate) return '-';
    const parts = isoDate.split('-');
    if (parts.length !== 3) return isoDate;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
};
