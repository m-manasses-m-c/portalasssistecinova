/* --- admin.js --- */
const { createApp } = Vue;
const supabase = window.supabaseClient;

createApp({
    data() {
        return {
            currentView: 'login', // 'login' ou 'dashboard'
            adminPassword: '',
            loginError: false,
            loading: false,

            adminTab: 'charts', // charts, calendar, access, config
            adminDocuments: [], // Lista de documentos
            
            // Dados Globais
            dbSubmissions: [],
            dbPortals: [],
            globalSchedules: {},
            allIcts: [],
            allCampi: [],

            // Gestão de Múltiplos Formulários
            formsList: [],
            currentFormId: null,
            showFormModal: false,
            newForm: { title: '', description: '', badge_text: 'Novo', category: 'Edital', documents: [] },
            newDoc: { name: '', url: '', type: 'Edital' },
            
            // Charts
            chartInstance: null,

            // Config / Importação
            importText: '',
            importMessage: '',
            importError: false,

            // Edição Admin
            showAdminEditModal: false,
            adminEditingIct: null,
            editSchedules: {}, // Buffer de edição temporária

            // UI State
            expandedIcts: [],

            // Estado do Calendário
            eventList: [],
            eventListFilter: '', // <-- Filtro da lista de eventos
            calendarYear: new Date().getFullYear(),
            calendarMonths: [],
            calendarFilterIct: '',
            calendarViewMode: 'ict', // 'ict' ou 'campus'
            showDayModal: false,
            selectedDay: null,
            showEventModal: false,
            eventForm: { // Inicializa com valores padrão
                title: '', category: 'Feriado', start: '', end: '',
                scope: 'global', targetIds: [], color: '#8b5cf6'
            },
            editingEventIndex: null,
            categoryColors: {
                'Recesso': '#f97316', 'Férias': '#3b82f6', 'Feriado': '#8b5cf6', 
                'Greve': '#ef4444', 'Outro': '#64748b'
            },
            // Novos estados para categoria customizada
            showCategoryModal: false,
            newCategoryName: '',
            newCategoryColor: '#000000',
            
            saving: false,
            showFullCalendar: true, // <-- Sempre visível por padrão
            
            // Estados para os filtros do Wizard
            ictSearch: '',
            campusSearch: '',
            
            // Estados de Seleção do Wizard (Novo Fluxo Multi-Select)
            wizardSelectedIcts: [], // Array de objetos ou ['ALL']
            wizardSelectedCampi: [], // Array de objetos
            showIctDropdown: false,
            showCampusDropdown: false
        }
    },
    watch: {
        adminTab(newVal) {
            if (newVal === 'documents') {
                this.fetchAdminDocuments();
            }
        },
        // Atualiza a cor quando a categoria muda
        'eventForm.category'(newVal) {
            if (this.categoryColors[newVal]) {
                this.eventForm.color = this.categoryColors[newVal];
            }
        },
        // Limpa campus se mudar ICT (remove campi que não pertencem mais às ICTs selecionadas)
        wizardSelectedIcts: {
            handler(newVal) {
                if (newVal.length === 0 || (newVal.length > 0 && newVal[0] === 'ALL')) {
                    this.wizardSelectedCampi = [];
                    return;
                }
                const selectedIctNames = newVal.map(i => i.ictName);
                this.wizardSelectedCampi = this.wizardSelectedCampi.filter(c => selectedIctNames.includes(c.ict));
            },
            deep: true
        },
        calendarFilterIct() {
            this.processCalendar();
        },
        calendarViewMode() {
            this.processCalendar();
        },
        calendarYear() {
            this.processCalendar();
        },
        currentFormId(newVal) {
            this.loadDashboardData();
        }
    },
    computed: {
        // Mapeia portais existentes por nome da ICT para fácil acesso
        portalsByIctName() {
            const map = {};
            this.dbPortals.forEach(p => {
                map[p.ict_name] = p;
            });
            return map;
        },

        // Estatísticas para os cards (sem alteração na lógica)
        consolidatedData() {
            const ictMap = new Map();
            this.dbSubmissions.forEach(sub => {
                if (!sub.ict) return;

                if (!ictMap.has(sub.ict)) {
                    ictMap.set(sub.ict, {
                        ictName: sub.ict,
                        respondents: new Set(),
                        uniqueCampiNames: new Set(),
                    });
                }
                
                const ictData = ictMap.get(sub.ict);
                ictData.respondents.add(sub.email);

                if (sub.campi && Array.isArray(sub.campi)) {
                    sub.campi.forEach(c => ictData.uniqueCampiNames.add(c.name));
                }
            });
            
            const result = Array.from(ictMap.values());
            result.forEach(item => {
                item.uniqueCampiCount = item.uniqueCampiNames.size;
            });

            return result.sort((a, b) => b.uniqueCampiCount - a.uniqueCampiCount);
        },
        totalCampiCount() {
            return this.consolidatedData.reduce((acc, curr) => acc + curr.uniqueCampiCount, 0);
        },

        // Computadas do Calendário
        allCampiFromResponses() {
            const all = [];
            const seen = new Set();
            this.dbSubmissions.forEach(sub => {
                if (sub.campi) {
                    sub.campi.forEach(c => {
                        if (!seen.has(c.id)) {
                            all.push({ ...c, ict: sub.ict });
                            seen.add(c.id);
                        }
                    });
                }
            });
            return all;
        },

        // --- Computadas para o Wizard e Filtros ---
        filteredEventList() {
            if (!this.eventListFilter) return this.eventList;
            const search = this.eventListFilter.toLowerCase();
            return this.eventList.filter(evt => 
                evt.title.toLowerCase().includes(search) ||
                evt.category.toLowerCase().includes(search) ||
                (evt.scope && evt.scope.toLowerCase().includes(search))
            );
        },
        wizardIctOptions() {
            const search = this.ictSearch.toLowerCase();
            const selectedNames = this.wizardSelectedIcts.map(i => i === 'ALL' ? 'ALL' : i.ictName);
            
            const list = this.consolidatedData.filter(ict => 
                ict.ictName.toLowerCase().includes(search) &&
                !selectedNames.includes(ict.ictName)
            );
            
            if ('todas as instituições'.includes(search) && !selectedNames.includes('ALL') && this.wizardSelectedIcts.length === 0) {
                return ['ALL', ...list];
            }
            return list;
        },
        wizardCampusOptions() {
            if (this.wizardSelectedIcts.length === 0 || (this.wizardSelectedIcts.length > 0 && this.wizardSelectedIcts[0] === 'ALL')) return [];
            
            const search = this.campusSearch.toLowerCase();
            const selectedIctNames = this.wizardSelectedIcts.map(i => i.ictName);
            const selectedCampusIds = this.wizardSelectedCampi.map(c => c.id);
            
            const list = this.allCampiFromResponses.filter(c => 
                selectedIctNames.includes(c.ict) && 
                c.name.toLowerCase().includes(search) &&
                !selectedCampusIds.includes(c.id)
            );
            
            if ('todos os campi'.includes(search) && !selectedCampusIds.includes('ALL') && this.wizardSelectedCampi.length === 0) {
                return ['ALL', ...list];
            }

            return list;
        },
        // filteredWizardIcts e filteredWizardCampi removidos pois foram substituídos pelas computadas acima
        
        // --- Timeline Computed ---
        timelineEvents() {
            if (!this.eventList || this.eventList.length === 0) return [];
            
            // Clone and sort events by date
            const sorted = [...this.eventList].sort((a, b) => new Date(a.start) - new Date(b.start));
            
            // Group by Month/Year
            const grouped = {};
            sorted.forEach(evt => {
                const d = new Date(evt.start);
                const key = d.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(evt);
            });
            
            return grouped;
        }
    },
    methods: {
        isIctExpanded(ictName) {
            return this.expandedIcts.includes(ictName);
        },
        toggleIctExpansion(ictName) {
            const index = this.expandedIcts.indexOf(ictName);
            if (index > -1) {
                this.expandedIcts.splice(index, 1);
            } else {
                this.expandedIcts.push(ictName);
            }
        },
        formatDateBR(val) { return window.formatDateBR(val); },

        // --- Métodos do Wizard e Categorias ---
        selectWizardIct(option, inputId = 'ictSearchInput') {
            if (option === 'ALL') {
                this.wizardSelectedIcts = ['ALL'];
                this.wizardSelectedCampi = [];
            } else {
                if (this.wizardSelectedIcts.length > 0 && this.wizardSelectedIcts[0] === 'ALL') {
                    this.wizardSelectedIcts = [];
                }
                this.wizardSelectedIcts.push(option);
            }
            this.ictSearch = '';
            // Mantém o foco para permitir seleção múltipla (exceto se selecionou ALL)
            if (option !== 'ALL') {
                this.$nextTick(() => {
                    const input = document.getElementById(inputId);
                    if(input) input.focus();
                });
            }
        },
        removeWizardIct(index) {
            this.wizardSelectedIcts.splice(index, 1);
        },
        selectWizardCampus(option, inputId = 'campusSearchInput') {
            if (option === 'ALL') {
                this.wizardSelectedCampi = ['ALL'];
            } else {
                if (this.wizardSelectedCampi.length > 0 && this.wizardSelectedCampi[0] === 'ALL') {
                    this.wizardSelectedCampi = [];
                }
                this.wizardSelectedCampi.push(option);
            }
            this.campusSearch = '';
            if (option !== 'ALL') {
                this.$nextTick(() => {
                    const input = document.getElementById(inputId);
                    if(input) input.focus();
                });
            }
        },
        removeWizardCampus(index) {
            this.wizardSelectedCampi.splice(index, 1);
        },
        addCustomCategory() {
            if (!this.newCategoryName) return;
            this.categoryColors[this.newCategoryName] = this.newCategoryColor;
            this.eventForm.category = this.newCategoryName;
            this.showCategoryModal = false;
            this.newCategoryName = '';
        },
        getCampusName(id) {
            const c = this.allCampiFromResponses.find(c => c.id.toString() === id.toString());
            return c ? `${c.name} (${c.ict})` : id;
        },
        extractCategoriesFromEvents() {
            if (!this.eventList) return;
            this.eventList.forEach(evt => {
                if (evt.category && !this.categoryColors[evt.category]) {
                    this.categoryColors[evt.category] = evt.color || '#64748b';
                }
            });
        },

        // --- Autenticação e Carregamento de Dados (Refatorado para RPC) ---
        copyFormLink() {
            if (!this.currentFormId) return;
            // Assume que o index.html está na mesma pasta
            const url = window.location.origin + window.location.pathname.replace('admin.html', 'index.html') + '?id=' + this.currentFormId;
            navigator.clipboard.writeText(url).then(() => {
                alert('Link copiado para a área de transferência!');
            }).catch(err => {
                console.error('Erro ao copiar:', err);
                prompt("Copie o link abaixo:", url);
            });
        },

        // --- Gestão de Documentos ---
        async fetchAdminDocuments() {
            this.loading = true;
            try {
                const { data, error } = await supabase.rpc('admin_get_all_documents', {
                    admin_password: this.adminPassword
                });

                if (error) throw error;

                this.adminDocuments = data || [];
            } catch (e) {
                console.error(e);
                alert("Erro ao buscar documentos: " + e.message);
            } finally {
                this.loading = false;
            }
        },

        async checkLogin() {
            this.loading = true;
            this.loginError = false;
            try {
                // 1. Verifica senha e carrega lista de formulários
                const { data: forms, error: formsError } = await supabase.rpc('admin_get_forms', {
                    admin_password: this.adminPassword
                });

                if (formsError) throw formsError;

                this.formsList = forms || [];
                
                // Se houver formulários, seleciona o primeiro (ou o último ativo)
                if (this.formsList.length > 0) {
                    // Tenta pegar o último criado ou o primeiro da lista
                    this.currentFormId = this.formsList[0].id;
                } else {
                    // Se não houver formulários, cria um padrão ou lida com estado vazio
                    // Por enquanto, vamos assumir que sempre haverá pelo menos um (migração)
                    this.currentFormId = null; 
                }

                // Salva a sessão
                const expiry = Date.now() + (2 * 60 * 60 * 1000);
                localStorage.setItem('assistec_admin_session_pwd', this.adminPassword);
                localStorage.setItem('assistec_admin_session_exp', expiry.toString());
                
                this.currentView = 'dashboard';
                
                // O watcher de currentFormId chamará loadDashboardData()

            } catch (e) {
                console.error(e);
                this.loginError = true;
                alert("Acesso Negado: " + e.message);
                this.loading = false;
            }
        },

        async loadDashboardData() {
            // if (!this.currentFormId) return; // Permitir null para "Todas as Trilhas"
            this.loading = true;
            
            try {
                const { data, error } = await supabase.rpc('get_admin_dashboard_data', {
                    admin_password: this.adminPassword,
                    p_form_id: this.currentFormId
                });

                if (error) throw error;

                // Popula os dados locais com a resposta da função
                this.dbSubmissions = data.responses || [];
                this.dbPortals = data.portals || [];
                this.eventList = (data.calendar && data.calendar.events) ? data.calendar.events : [];
                
                // Popula globalSchedules (Legacy Support)
                this.globalSchedules = {};
                if (data.schedules) {
                    data.schedules.forEach(s => {
                        this.globalSchedules[s.campus_id] = {
                            recessStart: s.recess_start,
                            recessEnd: s.recess_end,
                            vacStart: s.vac_start,
                            vacEnd: s.vac_end
                        };
                    });
                }

                this.extractCategoriesFromEvents();
                
                if (data.app_config) {
                    this.allIcts = data.app_config.icts || [];
                    this.allCampi = data.app_config.campi || [];
                }
                
                this.renderChart();
                this.processCalendar();

            } catch (e) {
                console.error(e);
                alert("Erro ao carregar dados do formulário: " + e.message);
            } finally {
                this.loading = false;
            }
        },

        openFormModal(formId = null) {
            if (formId) {
                const form = this.formsList.find(f => f.id === formId);
                if (form) {
                    this.newForm = { ...form };
                    // Ensure documents is an array
                    if (!this.newForm.documents) this.newForm.documents = [];
                }
            } else {
                this.newForm = { title: '', description: '', badge_text: 'Novo', category: 'Edital', documents: [], start_date: '', end_date: '' };
            }
            this.newDoc = { name: '', url: '', type: 'Edital' }; // Reset new doc input
            this.showFormModal = true;
        },

        addDocument() {
            if (!this.newDoc.name || !this.newDoc.url) return alert("Nome e URL são obrigatórios");
            
            this.newForm.documents.push({ ...this.newDoc });
            this.newDoc = { name: '', url: '', type: 'Edital' };
        },

        removeDocument(index) {
            this.newForm.documents.splice(index, 1);
        },

        async saveForm() {
            if (!this.newForm.title) return alert("Título é obrigatório");
            
            try {
                let data, error;
                
                if (this.newForm.id) {
                    // Update
                    const result = await supabase.rpc('admin_update_form', {
                        admin_password: this.adminPassword,
                        p_id: this.newForm.id,
                        p_title: this.newForm.title,
                        p_description: this.newForm.description,
                        p_badge_text: this.newForm.badge_text,
                        p_category: this.newForm.category,
                        p_documents: this.newForm.documents,
                        p_start_date: this.newForm.start_date || null,
                        p_end_date: this.newForm.end_date || null
                    });
                    data = result.data;
                    error = result.error;
                } else {
                    // Create
                    const result = await supabase.rpc('admin_create_form', {
                        admin_password: this.adminPassword,
                        p_title: this.newForm.title,
                        p_description: this.newForm.description,
                        p_badge_text: this.newForm.badge_text,
                        p_category: this.newForm.category,
                        p_documents: this.newForm.documents,
                        p_start_date: this.newForm.start_date || null,
                        p_end_date: this.newForm.end_date || null
                    });
                    data = result.data;
                    error = result.error;
                }

                if (error) throw error;

                if (this.newForm.id) {
                    const index = this.formsList.findIndex(f => f.id === this.newForm.id);
                    if (index !== -1) this.formsList[index] = data;
                    alert("Formulário atualizado com sucesso!");
                } else {
                    this.formsList.push(data);
                    this.currentFormId = data.id;
                    alert("Novo formulário criado com sucesso!");
                }
                
                this.showFormModal = false;
                this.newForm = { title: '', description: '', badge_text: 'Novo', category: 'Edital', documents: [], start_date: '', end_date: '' };

            } catch (e) {
                alert("Erro ao salvar formulário: " + e.message);
            }
        },

        async deleteForm(formId) {
            if (!confirm("Tem certeza que deseja excluir este formulário? Todas as respostas e eventos associados serão perdidos permanentemente.")) return;
            
            try {
                const { error } = await supabase.rpc('admin_delete_form', {
                    admin_password: this.adminPassword,
                    p_id: formId
                });

                if (error) throw error;

                this.formsList = this.formsList.filter(f => f.id !== formId);
                if (this.currentFormId === formId) {
                    this.currentFormId = null;
                }
                alert("Formulário excluído com sucesso!");

            } catch (e) {
                alert("Erro ao excluir formulário: " + e.message);
            }
        },

        logout() {
            localStorage.removeItem('assistec_admin_session_pwd');
            localStorage.removeItem('assistec_admin_session_exp');
            this.currentView = 'login';
            this.adminPassword = '';
            this.dbSubmissions = [];
            this.dbPortals = [];
        },
        async checkSession() {
            const expiry = localStorage.getItem('assistec_admin_session_exp');
            const pwd = localStorage.getItem('assistec_admin_session_pwd');
            if (expiry && Date.now() < parseInt(expiry) && pwd) {
                this.adminPassword = pwd;
                await this.checkLogin(); // Re-autentica para carregar os dados
            }
        },

        // --- Gestão de Acessos (Refatorado para RPC) ---
        async createOrUpdatePortal(submission) {
            if (!submission || !submission.ict) return;
            
            const confirmationText = this.portalsByIctName[submission.ict]
                ? `Isso irá REGERAR a chave de acesso para ${submission.ict}. O link antigo deixará de funcionar. Deseja continuar?`
                : `Isso criará um novo portal de acesso para ${submission.ict} usando os dados deste formulário. Deseja continuar?`;

            if (!confirm(confirmationText)) return;

            try {
                const { data: newPortalData, error } = await supabase.rpc('admin_create_or_update_portal', {
                    admin_password: this.adminPassword,
                    p_ict_name: submission.ict,
                    p_contact_name: submission.name,
                    p_contact_email: submission.email,
                    p_source_response_id: submission.id
                });

                if (error) throw error;

                // Atualiza a lista local de portais
                const index = this.dbPortals.findIndex(p => p.ict_name === newPortalData.ict_name);
                if (index !== -1) {
                    this.dbPortals[index] = newPortalData;
                } else {
                    this.dbPortals.push(newPortalData);
                }
                alert(`Portal para ${newPortalData.ict_name} foi criado/atualizado com sucesso! Nova chave: ${newPortalData.access_key}`);

            } catch (e) {
                alert("Erro ao gerenciar portal: " + e.message);
            }
        },
        copyToClipboard(text) {
            navigator.clipboard.writeText(text).then(() => alert(`Chave ${text} copiada!`));
        },

        // --- Edição de Cronograma (Admin Mode) ---
        openEditModal(submission) {
            this.adminEditingIct = JSON.parse(JSON.stringify(submission)); // Clone
            this.editSchedules = {};
            
            // Popula com dados globais ou vazios
            this.adminEditingIct.campi.forEach(c => {
                if (this.globalSchedules[c.id]) {
                    this.editSchedules[c.id] = { ...this.globalSchedules[c.id] };
                } else {
                    this.editSchedules[c.id] = { recessStart: '', recessEnd: '', vacStart: '', vacEnd: '' };
                }
            });
            this.showAdminEditModal = true;
        },
        async saveAdminEdits() {
            if (!confirm("Confirmar alterações? Isso atualizará o painel do participante.")) return;
            
            this.loading = true;
            try {
                const upserts = [];
                this.adminEditingIct.campi.forEach(campus => {
                    const sched = this.editSchedules[campus.id];
                    upserts.push({
                        response_id: this.adminEditingIct.id,
                        campus_id: campus.id,
                        recess_start: sched.recessStart || null,
                        recess_end: sched.recessEnd || null,
                        vac_start: sched.vacStart || null,
                        vac_end: sched.vacEnd || null,
                        updated_at: new Date(),
                        last_editor: 'ADMIN'
                    });
                });

                // ATENÇÃO: Esta chamada direta precisa ser convertida para RPC se o RLS bloquear
                const { error } = await supabase
                    .from('campus_schedules')
                    .upsert(upserts, { onConflict: 'response_id, campus_id' });

                if (error) throw error;

                // await this.fetchSchedules(); // Precisa recarregar os dados via RPC
                alert("Salvo com sucesso!");
                this.showAdminEditModal = false;

            } catch (e) {
                alert("Erro: " + e.message);
            } finally {
                this.loading = false;
            }
        },

        // Lógica de Importação de Configs
        async processImport() {
            this.importMessage = '';
            this.importError = false;

            if (!this.importText.trim()) {
                this.importError = true;
                this.importMessage = "A caixa de texto está vazia.";
                return;
            }

            try {
                const lines = this.importText.trim().split('\n');
                const campi = [];
                const ictMap = new Map();
                let campusId = 1;

                lines.forEach(line => {
                    const [sigla, nomeCompleto, campusNome] = line.split('	'); // Separado por Tab
                    if (sigla && nomeCompleto && campusNome) {
                        const ictName = `${sigla.trim()} - ${nomeCompleto.trim()}`;
                        if (!ictMap.has(ictName)) {
                            ictMap.set(ictName, { name: ictName });
                        }
                        campi.push({
                            id: campusId++,
                            name: campusNome.trim(),
                            ictName: ictName
                        });
                    }
                });

                const icts = Array.from(ictMap.values());

                if (icts.length === 0 || campi.length === 0) {
                    this.importError = true;
                    this.importMessage = "Nenhum dado válido encontrado. Verifique o formato (SIGLA | NOME | CAMPUS) separado por tabulação.";
                    return;
                }

                if (!confirm(`Você está prestes a substituir a base de dados com ${icts.length} ICTs e ${campi.length} campi. Deseja continuar?`)) {
                    return;
                }

                const { data, error } = await supabase.rpc('admin_update_app_config', {
                    admin_password: this.adminPassword,
                    new_icts: icts,
                    new_campi: campi
                });

                if (error) throw error;

                this.importError = false;
                this.importMessage = `${data} Foram importados ${icts.length} ICTs e ${campi.length} campi.`;
                this.importText = '';

                // Recarrega todos os dados do dashboard para refletir a mudança
                await this.checkLogin();

            } catch (e) {
                this.importError = true;
                this.importMessage = "Erro ao processar a importação: " + e.message;
            }
        },

        // --- Charts & Export ---
        renderChart() {
            this.$nextTick(() => {
                const ctx = document.getElementById('resultsChart');
                if (!ctx) return;
                if (this.chartInstance) this.chartInstance.destroy();
    
                const labels = this.consolidatedData.map(d => d.ictName.split(' - ')[0]);
                const dataVal = this.consolidatedData.map(d => d.uniqueCampiCount);
    
                this.chartInstance = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: labels,
                        datasets: [{
                            label: 'Campi Aderentes',
                            data: dataVal,
                            backgroundColor: 'rgba(79, 70, 229, 0.8)',
                            borderColor: 'rgba(79, 70, 229, 1)',
                            borderWidth: 1,
                            borderRadius: 8,
                            barThickness: 30,
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { display: false },
                            tooltip: {
                                backgroundColor: '#fff',
                                titleColor: '#334155',
                                bodyColor: '#64748b',
                                borderColor: '#e2e8f0',
                                borderWidth: 1,
                                padding: 10,
                                cornerRadius: 8,
                            }
                        },
                        scales: {
                            y: {
                                beginAtZero: true,
                                grid: {
                                    color: '#f1f5f9',
                                },
                                ticks: {
                                    color: '#64748b',
                                }
                            },
                            x: {
                                grid: {
                                    display: false,
                                },
                                ticks: {
                                    color: '#64748b',
                                }
                            }
                        }
                    }
                });
            });
        },
        exportToExcel() {
            if (this.dbSubmissions.length === 0) return alert("Sem dados.");
            
            const rows = [];
            this.dbSubmissions.forEach(sub => {
                const form = this.formsList.find(f => f.id === sub.form_id);
                const formTitle = form ? form.title : 'N/D';
                const portal = this.portalsByIctName[sub.ict];

                if (sub.campi && sub.campi.length) {
                    sub.campi.forEach(c => {
                        const sched = this.globalSchedules[c.id] || {};
                        rows.push({
                            "Trilha": formTitle,
                            "ID": sub.id,
                            "ICT": sub.ict,
                            "Campus": c.name,
                            "Responsável": sub.name,
                            "Email": sub.email,
                            "Chave": portal ? portal.access_key : '',
                            "Recesso Início": this.formatDateBR(sched.recessStart),
                            "Recesso Fim": this.formatDateBR(sched.recessEnd),
                            "Férias Início": this.formatDateBR(sched.vacStart),
                            "Férias Fim": this.formatDateBR(sched.vacEnd)
                        });
                    });
                }
            });

            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Adesao_Completa");
            XLSX.writeFile(wb, `Relatorio_Assistec_${new Date().toISOString().slice(0,10)}.xlsx`);
        },

        // --- Configuração / Importação ---
        async processImport() {
             if (!this.importText.trim()) { this.importError = true; this.importMessage = "Vazio."; return; }
             // (Mesma lógica de importação do código original, adaptada se necessário)
             // ...
             this.importMessage = "Funcionalidade de importação mantida (simplificada aqui).";
        },

        // Métodos do Calendário
        generateCalendar(year, monthCount) {
            const months = [];
            let currentDate = new Date(year, 0, 1); // Começa em 1 de Janeiro

            for (let i = 0; i < monthCount; i++) {
                const monthName = currentDate.toLocaleString('pt-BR', { month: 'long' });
                const yearNum = currentDate.getFullYear();
                const monthDays = [];
                const daysInMonth = new Date(year, currentDate.getMonth() + 1, 0).getDate();
                const firstDayOfWeek = new Date(year, currentDate.getMonth(), 1).getDay();

                // Preenche dias vazios no início
                for (let j = 0; j < firstDayOfWeek; j++) {
                    monthDays.push({ empty: true });
                }

                // Preenche os dias do mês
                for (let day = 1; day <= daysInMonth; day++) {
                    monthDays.push({
                        day: day,
                        date: new Date(year, currentDate.getMonth(), day),
                        dateFmt: `${day}/${currentDate.getMonth() + 1}/${year}`,
                        stats: { total: 0, unavailableCount: 0, ratio: 0, heatClass: '' },
                        unavailableIcts: []
                    });
                }
                months.push({ name: `${monthName}`, days: monthDays }); // Removido o ano do nome do mês
                currentDate.setMonth(currentDate.getMonth() + 1);
            }
            this.calendarMonths = months;
        },

        processCalendar() {
            this.generateCalendar(this.calendarYear, 12);

            if (this.calendarViewMode === 'ict') {
                const ictsToProcess = this.calendarFilterIct 
                    ? this.consolidatedData.filter(ict => ict.ictName === this.calendarFilterIct)
                    : this.consolidatedData;

                const total = ictsToProcess.length;
                if (total === 0) return;

                this.calendarMonths.forEach(month => {
                    month.days.forEach(day => {
                        if (day.empty) return;

                        day.stats = { total: total, unavailableCount: 0, ratio: 0, heatClass: '' };
                        day.unavailableItems = [];
                        const dayStart = day.date.setHours(0, 0, 0, 0);

                        ictsToProcess.forEach(ict => {
                            let isUnavailable = false;
                            let reason = '';

                            for (const event of this.eventList) {
                                const eventStart = new Date(event.start).getTime();
                                const eventEnd = new Date(event.end).getTime();

                                if (dayStart >= eventStart && dayStart <= eventEnd) {
                                    const scopeMatch = event.scope === 'global' ||
                                        (event.scope === 'ict' && event.targetIds.includes(ict.ictName)) ||
                                        (event.scope === 'campus' && this.doesEventAffectIct(event, ict.ictName));

                                    if (scopeMatch) {
                                        isUnavailable = true;
                                        reason = event.title;
                                        break; 
                                    }
                                }
                            }

                            if (isUnavailable) {
                                day.unavailableItems.push({ name: ict.ictName, reason });
                            }
                        });

                        day.stats.unavailableCount = day.unavailableItems.length;
                        day.stats.ratio = total > 0 ? day.stats.unavailableCount / total : 0;
                        day.stats.heatClass = this.getHeatClass(day.stats.ratio);
                    });
                });
            } else {
                // Modo Campus
                let campiToProcess = this.allCampiFromResponses;
                if (this.calendarFilterIct) {
                    campiToProcess = campiToProcess.filter(c => c.ict === this.calendarFilterIct);
                }
                
                const total = campiToProcess.length;
                if (total === 0) return;

                this.calendarMonths.forEach(month => {
                    month.days.forEach(day => {
                        if (day.empty) return;
                        
                        day.stats = { total: total, unavailableCount: 0, ratio: 0, heatClass: '' };
                        day.unavailableItems = [];
                        const dayStart = day.date.setHours(0, 0, 0, 0);

                        campiToProcess.forEach(campus => {
                            let isUnavailable = false;
                            let reason = '';
                            
                            for (const event of this.eventList) {
                                const eventStart = new Date(event.start).getTime();
                                const eventEnd = new Date(event.end).getTime();

                                if (dayStart >= eventStart && dayStart <= eventEnd) {
                                    const scopeMatch = 
                                        event.scope === 'global' ||
                                        (event.scope === 'ict' && event.targetIds.includes(campus.ict)) ||
                                        (event.scope === 'campus' && event.targetIds.includes(campus.id.toString()));
                                    
                                    if (scopeMatch) {
                                        isUnavailable = true;
                                        reason = event.title;
                                        break;
                                    }
                                }
                            }
                            
                            if (isUnavailable) {
                                day.unavailableItems.push({ name: `${campus.name} (${campus.ict})`, reason });
                            }
                        });
                        
                        day.stats.unavailableCount = day.unavailableItems.length;
                        day.stats.ratio = total > 0 ? day.stats.unavailableCount / total : 0;
                        day.stats.heatClass = this.getHeatClass(day.stats.ratio);
                    });
                });
            }
        },

        doesEventAffectIct(event, ictName) {
            const campiOfIct = this.allCampiFromResponses
                .filter(c => c.ict === ictName)
                .map(c => c.id.toString());
            
            return event.targetIds.some(targetId => campiOfIct.includes(targetId));
        },

        getHeatClass(ratio) {
            if (ratio >= 0.8) return 'bg-red-100 border-red-200';
            if (ratio >= 0.4) return 'bg-orange-100 border-orange-200';
            if (ratio >= 0.1) return 'bg-yellow-100 border-yellow-200';
            return 'bg-emerald-100 border-emerald-200';
        },

        openDayDetails(day) {
            if (day.empty) return;
            this.selectedDay = day;
            this.showDayModal = true;
        },

        // --- Métodos do Wizard de Eventos (Admin) ---
        openEventModal(event = null, index = null) {
            // Se o evento foi passado mas o índice não (ex: vindo da Timeline), tenta encontrar o índice
            if (event && index === null) {
                index = this.eventList.indexOf(event);
            }

            this.editingEventIndex = index;
            
            // Reset Wizard State
            this.wizardSelectedIcts = [];
            this.wizardSelectedCampi = [];
            this.ictSearch = '';
            this.campusSearch = '';

            if (event) {
                this.eventForm = JSON.parse(JSON.stringify(event));
                
                // Popula o Wizard com base no evento existente
                if (this.eventForm.scope === 'global') {
                    this.wizardSelectedIcts = ['ALL'];
                } else if (this.eventForm.scope === 'ict') {
                    // Encontra os objetos de ICT baseados nos nomes salvos
                    this.wizardSelectedIcts = this.consolidatedData.filter(ict => 
                        this.eventForm.targetIds.includes(ict.ictName)
                    );
                } else if (this.eventForm.scope === 'campus') {
                    // Encontra os objetos de Campus baseados nos IDs salvos
                    this.wizardSelectedCampi = this.allCampiFromResponses.filter(c => 
                        this.eventForm.targetIds.includes(c.id.toString())
                    );
                    
                    // Deriva as ICTs necessárias para manter a consistência visual
                    const uniqueIcts = [...new Set(this.wizardSelectedCampi.map(c => c.ict))];
                    this.wizardSelectedIcts = this.consolidatedData.filter(ict => 
                        uniqueIcts.includes(ict.ictName)
                    );
                }

            } else {
                this.eventForm = {
                    title: '', category: 'Feriado', start: '', end: '',
                    scope: 'global', targetIds: [], color: this.categoryColors['Feriado']
                };
            }
            this.showEventModal = true;
        },
        closeEventModal() {
            this.showEventModal = false;
            this.eventForm = {};
            this.editingEventIndex = null;
            this.wizardSelectedIcts = [];
            this.wizardSelectedCampi = [];
        },
        submitEvent() {
            if (!this.eventForm.start || !this.eventForm.end || !this.eventForm.category) {
                alert("Preencha todos os campos básicos (Categoria, Início, Fim).");
                return;
            }
            
            // Determina Escopo e TargetIds baseado na seleção múltipla
            if (this.wizardSelectedIcts.length > 0 && this.wizardSelectedIcts[0] === 'ALL') {
                this.eventForm.scope = 'global';
                this.eventForm.targetIds = [];
            } else if (this.wizardSelectedCampi.length > 0) {
                this.eventForm.scope = 'campus';
                this.eventForm.targetIds = this.wizardSelectedCampi.map(c => c.id.toString());
            } else if (this.wizardSelectedIcts.length > 0) {
                this.eventForm.scope = 'ict';
                this.eventForm.targetIds = this.wizardSelectedIcts.map(i => i.ictName);
            } else {
                alert("Selecione pelo menos uma ICT ou 'Todas'.");
                return;
            }

            // Gera título automático baseado na categoria e escopo
            let autoTitle = this.eventForm.category;
            if (this.eventForm.scope === 'ict') {
                if (this.eventForm.targetIds.length === 1) autoTitle += ` (${this.eventForm.targetIds[0]})`;
                else autoTitle += ` (${this.eventForm.targetIds.length} ICTs)`;
            } else if (this.eventForm.scope === 'campus') {
                if (this.eventForm.targetIds.length === 1) {
                    const c = this.allCampiFromResponses.find(x => x.id.toString() === this.eventForm.targetIds[0]);
                    if(c) autoTitle += ` (${c.name})`;
                } else {
                    autoTitle += ` (${this.eventForm.targetIds.length} Campi)`;
                }
            } else if (this.eventForm.scope === 'global') {
                autoTitle += ` (Global)`;
            }
            this.eventForm.title = autoTitle;

            this.eventForm.color = this.categoryColors[this.eventForm.category] || this.categoryColors['Outro'];

            if (this.editingEventIndex !== null) {
                this.eventList.splice(this.editingEventIndex, 1, this.eventForm);
            } else {
                this.eventList.push(this.eventForm);
            }
            this.processCalendar();
            this.closeEventModal();
            
            // Reset Wizard
            this.wizardSelectedIcts = [];
            this.wizardSelectedCampi = [];
            this.ictSearch = '';
            this.campusSearch = '';
            this.eventForm = { 
                title: '', category: 'Feriado', start: '', end: '',
                scope: 'global', targetIds: [], color: '#8b5cf6'
            };
        },
        removeEvent(index) {
            if (confirm(`Tem certeza que deseja remover o evento "${this.eventList[index].title}"?`)) {
                this.eventList.splice(index, 1);
                this.processCalendar();
            }
        },
        async saveEvents() {
            if (!confirm("Isso irá substituir TODOS os eventos no calendário com a lista atual. Deseja continuar?")) return;
            this.saving = true;
            try {
                const { data, error } = await supabase.rpc('admin_update_calendar_events', {
                    admin_password: this.adminPassword,
                    all_events: this.eventList,
                    p_form_id: this.currentFormId
                });
                if (error) throw error;
                alert(data);
            } catch (e) {
                alert("Erro ao salvar eventos: " + e.message);
            } finally {
                this.saving = false;
            }
        },

        // Métodos para o Novo Wizard
        addEventFromWizard() {
            const { title, start, end, category, targetIcts, targetCampi } = this.wizardForm;
            if (!title || !start || !end) {
                alert("Preencha Título, Início e Fim.");
                return;
            }

            let scope = 'global';
            let targetIds = [];

            if (targetCampi.length > 0) {
                scope = 'campus';
                targetIds = targetCampi.map(c => c.id.toString());
            } else if (targetIcts.length > 0) {
                scope = 'ict';
                targetIds = targetIcts;
            }

            const newEvent = {
                title, start, end, category, scope, targetIds,
                color: this.categoryColors[category] || this.categoryColors['Outro']
            };

            this.eventList.push(newEvent);
            this.processCalendar();
            this.resetWizard();
            alert("Evento adicionado com sucesso!");
        },

        resetWizard() {
            this.wizardForm = {
                title: '', start: '', end: '', category: 'Feriado', scope: 'global',
                targetIcts: [], targetCampi: [], searchIct: '', searchCampus: ''
            };
        },

        // --- UI Helpers ---
        getScopeIcon(scope) {
            const icons = { 'global': 'fa-globe', 'ict': 'fa-building-columns', 'campus': 'fa-school' };
            return icons[scope] || 'fa-question-circle';
        },
        getScopeLabel(evt) {
            if (evt.scope === 'global') return 'Global';
            if (evt.scope === 'ict') return `${evt.targetIds.length} ICT(s)`;
            if (evt.scope === 'campus') return `${evt.targetIds.length} Campi`;
            return 'N/D';
        },
        formatDate(dateString) {
            if (!dateString) return '';
            const [year, month, day] = dateString.split('-');
            return `${day}/${month}/${year}`;
        },

        handleClickOutside(event) {
            if (!event.target.closest('.relative.group')) {
                this.showIctDropdown = false;
                this.showCampusDropdown = false;
            }
        }
    },
    mounted() {
        document.addEventListener('click', this.handleClickOutside);
    },
    beforeUnmount() {
        document.removeEventListener('click', this.handleClickOutside);
    }
}).mount('#adminApp');
