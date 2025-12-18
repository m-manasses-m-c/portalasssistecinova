/* --- form.js --- */
const { createApp } = Vue;
const supabase = window.supabaseClient;

createApp({
    data() {
        return {
            currentView: 'form', // 'form' ou 'success'
            loading: false, 
            cookiesAccepted: false,

            // Estrutura atualizada com novos campos
            form: this.getInitialFormData(),
            
            searchIct: '',
            showIctDropdown: false,
            searchCampus: '',
            showCampusDropdown: false, 
            
            allIcts: [], 
            allCampi: []
        }
    },
    watch: {
        // Máscaras automáticas ao digitar
        'form.cellphone'(val) { this.form.cellphone = this.maskPhone(val); },
        'form.keyContactCellphone'(val) { this.form.keyContactCellphone = this.maskPhone(val); }
    },
    computed: {
        filteredIcts() {
            if (!this.searchIct) return this.allIcts.slice(0, 10);
            const term = this.searchIct.toLowerCase();
            return this.allIcts.filter(ict => ict.toLowerCase().includes(term)).slice(0, 20);
        },
        filteredAvailableCampi() {
            if (!this.form.ict) return []; 
            let term = this.searchCampus.toLowerCase();
            return this.allCampi.filter(c => 
                // Verifica se o campus pertence à ICT selecionada
                (c.ictName === this.form.ict || c.ict_name === this.form.ict) && 
                c.name.toLowerCase().includes(term) && 
                !this.form.selectedCampi.some(sel => sel.id === c.id)
            ).slice(0, 50);
        }
    },
    methods: {
        // --- Helpers ---
        getInitialFormData() {
            return { 
                name: '', 
                email: '', 
                cellphone: '', 
                ict: '', 
                selectedCampi: [],
                isKeyContact: false, // Começa desmarcado ou marcado, conforme preferência. No HTML deixei checkbox.
                keyContactName: '',
                keyContactEmail: '',
                keyContactCellphone: ''
            };
        },
        maskPhone(value) {
            if (!value) return '';
            return value
                .replace(/\D/g, '') // Remove tudo que não é dígito
                .replace(/(\d{2})(\d)/, '($1) $2') // Coloca parênteses
                .replace(/(\d{5})(\d)/, '$1-$2') // Coloca hífen
                .replace(/(-\d{4})\d+?$/, '$1'); // Limita tamanho
        },

        // --- UX / Cookies ---
        checkCookies() { if (localStorage.getItem('cookiesAccepted')) this.cookiesAccepted = true; },
        acceptCookies() { localStorage.setItem('cookiesAccepted', 'true'); this.cookiesAccepted = true; },
        
        // Mantemos o delayHide como fallback, mas o @mousedown.prevent no HTML resolve o principal bug
        delayHideIct() { setTimeout(() => { this.showIctDropdown = false; }, 200); },
        delayHideCampus() { setTimeout(() => { this.showCampusDropdown = false; }, 200); },

        // --- Configuração Inicial ---
        async fetchGlobalConfig() {
            try {
                // Busca configurações (ICTs e Campi) do Supabase
                const { data, error } = await supabase.from('app_config').select('*').limit(1).single();
                
                if (data && !error) {
                    if (data.icts?.length) this.allIcts = data.icts;
                    if (data.campi?.length) this.allCampi = data.campi;
                } else { 
                    console.warn("Config não encontrada, usando padrão.");
                    this.loadDefaultData(); 
                }
            } catch (e) { 
                console.error("Erro ao carregar config:", e);
                this.loadDefaultData(); 
            }
        },
        loadDefaultData() {
            // Dados de fallback caso o banco falhe
            this.allIcts = ['IFSP', 'IFSC', 'IFRJ', 'Paula Souza (FATEC/ETEC)'];
            this.allCampi = [
                { id: 1, name: 'Campus São Paulo', ictName: 'IFSP' },
                { id: 2, name: 'Campus Cubatão', ictName: 'IFSP' }
            ];
        },

        // --- Lógica de Seleção ---
        selectIct(ictName) { 
            this.form.ict = ictName; 
            this.searchIct = ''; // Limpa a busca visualmente (já que o input é substituído pelo botão de fechar)
            this.showIctDropdown = false; 
            this.form.selectedCampi = []; // Reseta campi ao trocar ICT
        },
        resetIctSelection() { 
            this.form.ict = ''; 
            this.form.selectedCampi = []; 
            this.searchCampus = ''; 
            // Foco volta para o input automaticamente via HTML/Vue se necessário, 
            // mas aqui apenas limpamos o estado.
        },
        addCampus(campus) { 
            this.form.selectedCampi.push({ ...campus, addedAt: new Date().toISOString() }); 
            this.searchCampus = ''; 
            // Mantém o dropdown aberto para adicionar mais se quiser? 
            // Se quiser fechar: this.showCampusDropdown = false;
             this.$refs.campusInput?.focus(); // Opcional: manter foco no input
        },
        tryAddFirstMatch() { 
            if (this.filteredAvailableCampi.length > 0) {
                this.addCampus(this.filteredAvailableCampi[0]);
            }
        },
        removeCampus(index) { 
            this.form.selectedCampi.splice(index, 1); 
        },
        
        // --- Envio ---
        async submitForm() {
            // 1. Validação Básica
            if (!this.form.name || !this.form.email || !this.form.cellphone || !this.form.ict) { 
                alert("Por favor, preencha seus dados pessoais e selecione a instituição."); 
                return; 
            }
            if (this.form.selectedCampi.length === 0) {
                alert("Selecione ao menos um campus para adesão.");
                return;
            }

            // 2. Validação Condicional (Contato Chave)
            if (!this.form.isKeyContact) {
                if (!this.form.keyContactName || !this.form.keyContactEmail || !this.form.keyContactCellphone) {
                    alert("Como você não é o contato chave, preencha os dados do Responsável.");
                    return;
                }
            }

            this.loading = true;

            try {
                // 3. Preparar Payload (Normalização de dados)
                // Se o usuário É o contato chave, duplicamos os dados dele para as colunas de contato chave
                const payload = {
                    name: this.form.name,
                    email: this.form.email,
                    cellphone: this.form.cellphone, // Novo campo
                    ict: this.form.ict,
                    campi: this.form.selectedCampi,
                    
                    is_key_contact: this.form.isKeyContact,
                    
                    // Lógica para preencher contato chave
                    key_contact_name: this.form.isKeyContact ? this.form.name : this.form.keyContactName,
                    key_contact_email: this.form.isKeyContact ? this.form.email : this.form.keyContactEmail,
                    key_contact_cellphone: this.form.isKeyContact ? this.form.cellphone : this.form.keyContactCellphone,
                    
                    status: 'pending',
                    submitted_at: new Date().toISOString()
                };

                // 4. Envio ao Supabase
                const { error } = await supabase.from('responses').insert(payload);
                
                if (error) throw error;
                
                this.currentView = 'success'; 
                this.form = this.getInitialFormData(); // Reset total
                this.searchIct = '';
                
            } catch (error) { 
                console.error(error);
                alert("Erro ao enviar o formulário: " + (error.message || "Erro desconhecido")); 
            } finally { 
                this.loading = false; 
            }
        },
        
        resetFormState() { 
            this.currentView = 'form'; 
            this.form = this.getInitialFormData();
            this.resetIctSelection(); 
        }
    },
    mounted() {
        this.checkCookies();
        this.fetchGlobalConfig();
    }
}).mount('#app');
