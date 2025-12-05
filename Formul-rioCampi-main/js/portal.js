/* --- portal.js --- */
const { createApp } = Vue;
const supabase = window.supabaseClient;

createApp({
    data() {
        return {
            currentView: 'login', // 'login' ou 'dashboard'
            loading: false,
            accessKey: '',
            loginError: false,
            
            // Estrutura de dados refatorada
            portalInfo: null,  // Dados da tabela ict_portals
            latestResponse: null, // Dados da submissão mais recente (para lista de campi)
            eventList: [], 
            
            saving: false,

            // Modal de Evento
            showEventModal: false,
            eventForm: {},
            editingEventIndex: null,
            
            categoryColors: {
                'Recesso': '#f97316', 'Férias': '#3b82f6', 'Feriado': '#8b5cf6', 
                'Greve': '#ef4444', 'Outro': '#64748b'
            }
        }
    },
    computed: {
        // Propriedade computada para facilitar o acesso aos dados do usuário no template
        currentUser() {
            if (!this.portalInfo || !this.latestResponse) return null;
            return {
                ict: this.portalInfo.ict_name,
                name: this.portalInfo.contact_name,
                campi: this.latestResponse.campi || []
            };
        }
    },
    methods: {
        formatDateBR(val) { return window.formatDateBR(val); },

        // --- Login (Refatorado para RPC) ---
        async loginWithKey() {
            if (!this.accessKey) return;
            this.loading = true;
            this.loginError = false;
            try {
                const { data, error } = await supabase.rpc('get_portal_data_with_key', {
                    p_access_key: this.accessKey.trim()
                });

                if (error) throw error;

                this.portalInfo = data.portal;
                this.latestResponse = data.response;
                
                await this.fetchUserEvents();
                this.currentView = 'dashboard';

            } catch (e) {
                console.error(e);
                this.loginError = true;
            } finally {
                this.loading = false;
            }
        },
        logout() {
            this.portalInfo = null;
            this.latestResponse = null;
            this.accessKey = '';
            this.currentView = 'login';
        },

        // --- Gestão de Eventos (Refatorado para RPC) ---
        async fetchUserEvents() {
            try {
                const { data, error } = await supabase.rpc('get_events_for_portal', {
                    p_access_key: this.accessKey.trim()
                });
                if (error) throw error;
                this.eventList = data || [];
            } catch (e) {
                alert("Erro ao carregar eventos: " + e.message);
                this.eventList = [];
            }
        },
        openEventModal(event = null, index = null) {
            this.editingEventIndex = index;
            if (event) {
                this.eventForm = JSON.parse(JSON.stringify(event));
            } else {
                this.eventForm = {
                    title: '', category: 'Recesso', newCategory: '', start: '', end: '',
                    scope: 'all', targetIds: []
                };
            }
            this.showEventModal = true;
        },
        closeEventModal() {
            this.showEventModal = false;
            this.eventForm = {};
            this.editingEventIndex = null;
        },
        submitEvent() {
            if (!this.eventForm.title || !this.eventForm.start || !this.eventForm.end) {
                alert("Preencha título, data de início e fim."); return;
            }

            const newEvent = {
                ...this.eventForm,
                color: this.categoryColors[this.eventForm.category] || this.categoryColors['Outro'],
                targetIds: this.eventForm.scope === 'all' ? [] : this.eventForm.targetIds
            };

            if (this.editingEventIndex !== null) {
                this.eventList[this.editingEventIndex] = newEvent;
            } else {
                this.eventList.push(newEvent);
            }
            this.closeEventModal();
        },
        removeEvent(index) {
            if (confirm("Tem certeza que deseja remover este evento?")) {
                this.eventList.splice(index, 1);
            }
        },
        
        // --- Sincronização com Supabase (Refatorado para RPC) ---
        async saveEvents() {
            if (!confirm("Isso irá substituir todos os eventos para esta ICT. Deseja continuar?")) return;
            this.saving = true;
            try {
                const { error } = await supabase.rpc('partner_update_events', {
                    p_access_key: this.accessKey.trim(),
                    p_user_events: this.eventList
                });

                if (error) throw error;
                
                alert("Eventos salvos com sucesso!");

            } catch (e) {
                alert("Erro ao salvar: " + e.message);
            } finally {
                this.saving = false;
            }
        },

        // --- UI Helpers ---
        getScopeIcon(scope) {
            const icons = { 'all': 'fa-globe', 'specific': 'fa-map-marker-alt' };
            return icons[scope] || 'fa-question-circle';
        },
        getScopeLabel(evt) {
            if (evt.scope === 'all') return 'Todos os campi';
            if (evt.scope === 'specific') return `${evt.targetIds.length} campi`;
            return 'N/D';
        },
    }
}).mount('#portalApp'); // Certifique-se que o ID no portal.html é #portalApp
