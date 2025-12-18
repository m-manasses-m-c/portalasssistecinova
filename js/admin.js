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

            adminSection: 'home', // 'home', 'forms', 'institutions', 'specialists', 'config'
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
            specialistChartInstance: null,

            // Config / Importação
            importText: '',
            importMessage: '',
            importError: false,
            importEventsText: '',
            importEventsMessage: '',
            importEventsError: false,

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
            timelineFilterIct: '', // Filtro da Timeline
            calendarViewMode: 'ict', // 'ict' ou 'campus'
            showDayModal: false,
            selectedDay: null,
            showEventModal: false,
            eventForm: { // Inicializa com valores padrão
                title: '', category: 'Feriado', start: '', end: '',
                scope: 'global', targetIds: [], color: '#8b5cf6'
            },
            inlineEventForm: { // Form separado para o wizard inline
                category: 'Feriado', start: '', end: ''
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
            
            // Gestão de Grupos (Edital)
            editalGroups: [],
            newEditalGroup: { name: '' },
            newGroupMember: {}, // { groupId: ictId }
            newGroupSupervisor: {}, // { groupId: specialistId }
            
            saving: false,
            showFullCalendar: true, // <-- Sempre visível por padrão
            
            // Estados para os filtros do Wizard
            ictSearch: '',
            campusSearch: '',
            
            // Estados de Seleção do Wizard (Novo Fluxo Multi-Select)
            wizardSelectedIcts: [], // Array de objetos ou ['ALL']
            wizardSelectedCampi: [], // Array de objetos
            showIctDropdown: false,
            showCampusDropdown: false,

            // Bulk Actions
            selectedEvents: [],

            // Coverage Stats UI
            showCoverageDetails: false,

            // Specialist Management
            accessViewMode: 'institutions',
            specialistsList: [],
            specialistAssignments: [], // Lista de designações
            newAssignment: { specialist_id: null, ict_portal_id: null, role: 'Membro' },
            showSpecialistModal: false,
            newSpecialist: { name: '', email: '', specialty: '' },
            
            // Specialist Reports View
            showSpecialistReportsModal: false,
            currentSpecialistReports: [],
            selectedSpecialistName: '',

            // Chat Admin
            chatChannels: [],
            currentChannel: null,
            chatMessages: [],
            newMessage: '',
            chatSubscription: null,
            showNewChannelModal: false,
            newChannel: { name: '', type: 'general', description: '' }
        }
    },
    watch: {
        chatMessages() {
            this.$nextTick(() => {
                this.scrollToBottom();
            });
        },
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
        isAllEventsSelected() {
            return this.filteredEventList.length > 0 && this.selectedEvents.length === this.filteredEventList.length;
        },
        coverageStats() {
            const icts = this.consolidatedData;
            const campi = this.allCampiFromResponses;
            const events = this.eventList;

            // Check for global events
            const hasGlobal = events.some(e => e.scope === 'global');

            if (hasGlobal) {
                return {
                    ict: { total: icts.length, withData: icts.length, withoutData: [], percent: 100 },
                    campus: { total: campi.length, withData: campi.length, withoutData: [], percent: 100 }
                };
            }

            // Analyze ICTs
            const ictsWithout = [];
            icts.forEach(ict => {
                const hasEvent = events.some(evt => {
                    if (evt.scope === 'ict') return evt.targetIds.includes(ict.ictName);
                    if (evt.scope === 'campus') return this.doesEventAffectIct(evt, ict.ictName);
                    return false;
                });
                if (!hasEvent) ictsWithout.push(ict.ictName);
            });

            // Analyze Campi
            const campiWithout = [];
            campi.forEach(c => {
                const hasEvent = events.some(evt => {
                    if (evt.scope === 'ict') return evt.targetIds.includes(c.ict);
                    if (evt.scope === 'campus') return evt.targetIds.includes(c.id.toString());
                    return false;
                });
                if (!hasEvent) campiWithout.push({ id: c.id, name: c.name, ict: c.ict });
            });

            return {
                ict: {
                    total: icts.length,
                    withData: icts.length - ictsWithout.length,
                    withoutData: ictsWithout,
                    percent: icts.length ? Math.round(((icts.length - ictsWithout.length) / icts.length) * 100) : 0
                },
                campus: {
                    total: campi.length,
                    withData: campi.length - campiWithout.length,
                    withoutData: campiWithout,
                    percent: campi.length ? Math.round(((campi.length - campiWithout.length) / campi.length) * 100) : 0
                }
            };
        },
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

        availableGroupMembers() {
            const options = [];
            
            // 1. Add ICTs (Whole Institution)
            this.dbPortals.forEach(portal => {
                options.push({
                    id: portal.id,
                    name: portal.ict_name + ' (Todos os Campi)',
                    type: 'ICT',
                    campus: null
                });
            });

            // 2. Add Individual Campuses
            const portalMap = {};
            this.dbPortals.forEach(p => portalMap[p.ict_name] = p.id);

            this.allCampiFromResponses.forEach(campus => {
                const portalId = portalMap[campus.ict];
                if (portalId) {
                    options.push({
                        id: portalId, // Same Portal ID
                        name: `${campus.ict} - ${campus.name}`,
                        type: 'Campus',
                        campus: campus.name
                    });
                }
            });

            return options.sort((a, b) => a.name.localeCompare(b.name));
        },

        // --- Computadas para o Wizard e Filtros ---
        filteredEventList() {
            if (!this.eventListFilter) return this.eventList;
            const search = this.eventListFilter.toLowerCase();
            return this.eventList.filter(evt => {
                if (!evt) return false;
                return (evt.title && evt.title.toLowerCase().includes(search)) ||
                       (evt.category && evt.category.toLowerCase().includes(search)) ||
                       (evt.scope && evt.scope.toLowerCase().includes(search));
            });
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
            if (!this.eventList || !Array.isArray(this.eventList) || this.eventList.length === 0) return [];
            
            // Filter valid events first
            let validEvents = this.eventList.filter(e => e && e.start);

            // Apply Filter
            if (this.timelineFilterIct) {
                const filter = this.timelineFilterIct;
                validEvents = validEvents.filter(evt => {
                    if (evt.scope === 'global') return true;
                    
                    if (filter.startsWith('GROUP:')) {
                        const groupId = filter.split(':')[1];
                        const group = this.customGroups.find(g => g.id.toString() === groupId);
                        if (!group) return false;
                        
                        if (group.type === 'ict') {
                            if (evt.scope === 'ict') return evt.targetIds.some(id => group.items.includes(id));
                            if (evt.scope === 'campus') return group.items.some(ictName => this.doesEventAffectIct(evt, ictName));
                        } else { // type === 'campus'
                            if (evt.scope === 'ict') {
                                return group.items.some(campusId => {
                                    const campus = this.allCampiFromResponses.find(c => c.id.toString() === campusId.toString());
                                    return campus && evt.targetIds.includes(campus.ict);
                                });
                            }
                            if (evt.scope === 'campus') return evt.targetIds.some(id => group.items.includes(id));
                        }
                    } else {
                        if (evt.scope === 'ict') return evt.targetIds.includes(filter);
                        if (evt.scope === 'campus') return this.doesEventAffectIct(evt, filter);
                    }
                    return false;
                });
            }

            // Clone and sort events by date
            const sorted = [...validEvents].sort((a, b) => {
                try {
                    return new Date(a.start) - new Date(b.start);
                } catch (e) { return 0; }
            });
            
            // Group by Month/Year
            const grouped = {};
            sorted.forEach(evt => {
                try {
                    const d = new Date(evt.start);
                    if (isNaN(d.getTime())) return;
                    
                    const key = d.toLocaleString('pt-BR', { month: 'long', year: 'numeric' });
                    if (!grouped[key]) grouped[key] = { monthName: key, year: d.getFullYear(), events: [] };
                    grouped[key].events.push(evt);
                } catch (e) { console.warn("Skipping invalid event in timeline", evt); }
            });
            
            // Convert object to array and sort by date (using the first event of each group as proxy)
            return Object.values(grouped).sort((a, b) => {
                if (a.events.length && b.events.length) {
                    return new Date(a.events[0].start) - new Date(b.events[0].start);
                }
                return 0;
            });
        }
    },
    methods: {
        selectSection(section) {
            this.adminSection = section;
            // Set default tab for each section
            if (section === 'forms') {
                this.adminTab = 'manage';
            } else if (section === 'institutions') {
                this.adminTab = 'calendar';
            } else if (section === 'specialists') {
                this.adminTab = 'specialists_dashboard';
                this.fetchSpecialists();
                // Ensure we don't have a stale form ID if we want to force selection, 
                // but keeping it might be nice if user switches back and forth.
                // However, the UI now requires selection from the sidebar.
                if (this.currentFormId) {
                    this.fetchEditalGroups();
                }
            } else if (section === 'config') {
                this.adminTab = 'config';
                // Ensure data is loaded for access keys if needed
                if (this.dbSubmissions.length === 0) {
                    this.loadDashboardData();
                }
            } else {
                this.adminTab = ''; // Home
            }
        },

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
            this.inlineEventForm.category = this.newCategoryName;
            this.showCategoryModal = false;
            this.newCategoryName = '';
            this.saveCategories(); // Save to DB
        },
        async fetchCategories() {
            try {
                const { data, error } = await supabase
                    .from('app_config')
                    .select('event_categories')
                    .eq('id', 1)
                    .single();
                
                if (data && data.event_categories) {
                    this.categoryColors = { ...this.categoryColors, ...data.event_categories };
                }
            } catch (e) {
                console.error("Error fetching categories:", e);
            }
        },
        async saveCategories() {
            try {
                const { error } = await supabase
                    .from('app_config')
                    .update({ 
                        event_categories: this.categoryColors,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', 1);
                
                if (error) throw error;
            } catch (e) {
                console.error("Error saving categories:", e);
                alert("Erro ao salvar nova categoria no servidor.");
            }
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
                
                // Carrega configurações globais
                this.fetchCategories();
                this.loadChatChannels(); // Load chat channels on login

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
                
                // Safety check for eventList
                let events = [];
                if (data.calendar && Array.isArray(data.calendar.events)) {
                    events = data.calendar.events;
                } else if (data.calendar && typeof data.calendar.events === 'string') {
                    try {
                        events = JSON.parse(data.calendar.events);
                    } catch (e) {
                        console.error("Erro ao parsear eventos do calendário:", e);
                    }
                }
                this.eventList = Array.isArray(events) ? events : [];
                
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
                    this.customGroups = data.app_config.custom_groups || [];
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
                    p_icts: icts,
                    p_campi: campi
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

        renderSpecialistChart() {
            this.$nextTick(() => {
                const ctx = document.getElementById('specialistChart');
                if (!ctx) return;
                if (this.specialistChartInstance) this.specialistChartInstance.destroy();

                // Group by Specialty
                const specialtyCounts = {};
                this.specialistsList.forEach(s => {
                    const spec = s.specialty || 'Outros';
                    specialtyCounts[spec] = (specialtyCounts[spec] || 0) + (s.report_count || 0);
                });

                const labels = Object.keys(specialtyCounts);
                const dataVal = Object.values(specialtyCounts);

                // If no data, show empty state or just 0s
                if (labels.length === 0) {
                    labels.push('Sem dados');
                    dataVal.push(1); // Placeholder
                }

                this.specialistChartInstance = new Chart(ctx, {
                    type: 'doughnut',
                    data: {
                        labels: labels,
                        datasets: [{
                            data: dataVal,
                            backgroundColor: [
                                '#4f46e5', '#06b6d4', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#64748b'
                            ],
                            borderWidth: 0
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } },
                            title: { display: false }
                        },
                        cutout: '70%'
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

        async exportCalendarPDF(event) {
            if (!window.jspdf || !window.html2canvas) {
                return alert("Bibliotecas de PDF não carregadas. Tente recarregar a página.");
            }
            
            const element = document.getElementById('calendarGrid');
            if (!element) return alert("Calendário não encontrado na tela.");

            const btn = event.currentTarget;
            const originalContent = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
            btn.disabled = true;

            try {
                const canvas = await html2canvas(element, { 
                    scale: 1.5, 
                    backgroundColor: '#ffffff',
                    logging: false,
                    useCORS: true
                });
                
                const imgData = canvas.toDataURL('image/png');
                const { jsPDF } = window.jspdf;
                const pdf = new jsPDF('l', 'mm', 'a4'); // Landscape
                
                const pdfWidth = pdf.internal.pageSize.getWidth();
                const pdfHeight = pdf.internal.pageSize.getHeight();
                const margin = 10;
                
                const imgWidth = pdfWidth - (margin * 2);
                const imgHeight = (canvas.height * imgWidth) / canvas.width;
                
                pdf.setFontSize(14);
                pdf.text(`Calendário de Disponibilidade - ${this.calendarYear}`, margin, margin);
                
                let yPos = margin + 10;
                
                // Fit to page if too large
                if (imgHeight > (pdfHeight - yPos - margin)) {
                    const ratio = (pdfHeight - yPos - margin) / imgHeight;
                    pdf.addImage(imgData, 'PNG', margin, yPos, imgWidth * ratio, imgHeight * ratio);
                } else {
                    pdf.addImage(imgData, 'PNG', margin, yPos, imgWidth, imgHeight);
                }
                
                pdf.save(`Calendario_${this.calendarYear}.pdf`);

            } catch (e) {
                console.error(e);
                alert("Erro ao gerar PDF: " + e.message);
            } finally {
                btn.innerHTML = originalContent;
                btn.disabled = false;
            }
        },

        // --- Configuração / Importação ---
        async processImport() {
             if (!this.importText.trim()) { this.importError = true; this.importMessage = "Vazio."; return; }
             // (Mesma lógica de importação do código original, adaptada se necessário)
             // ...
             this.importMessage = "Funcionalidade de importação mantida (simplificada aqui).";
        },

        // --- Importação de Eventos (Excel) ---
        processEventsImport() {
            if (!this.importEventsText.trim()) {
                this.importEventsError = true;
                this.importEventsMessage = "Cole os dados do Excel primeiro.";
                return;
            }

            const lines = this.importEventsText.trim().split('\n');
            let successCount = 0;
            let errorCount = 0;
            let log = [];

            // Helper: Levenshtein Distance for Fuzzy Match
            const levenshtein = (a, b) => {
                if (!a || !b) return 100;
                a = a.toLowerCase().trim();
                b = b.toLowerCase().trim();
                if (a.length === 0) return b.length;
                if (b.length === 0) return a.length;
                const matrix = [];
                for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
                for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
                for (let i = 1; i <= b.length; i++) {
                    for (let j = 1; j <= a.length; j++) {
                        if (b.charAt(i - 1) === a.charAt(j - 1)) {
                            matrix[i][j] = matrix[i - 1][j - 1];
                        } else {
                            matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
                        }
                    }
                }
                return matrix[b.length][a.length];
            };

            const findBestMatch = (input, options) => {
                if (!input) return null;
                let bestMatch = null;
                let minDistance = Infinity;
                
                // Normalização básica
                const normalizedInput = input.toLowerCase().trim();

                for (const opt of options) {
                    const normalizedOpt = opt.toLowerCase().trim();
                    
                    // Match exato ou substring
                    if (normalizedOpt === normalizedInput || normalizedOpt.includes(normalizedInput) || normalizedInput.includes(normalizedOpt)) {
                        return opt; // Retorna imediatamente se for muito parecido
                    }

                    const dist = levenshtein(input, opt);
                    if (dist < minDistance) {
                        minDistance = dist;
                        bestMatch = opt;
                    }
                }
                
                // Threshold: Se a distância for maior que 40% do tamanho da string, ignora
                if (minDistance > Math.max(input.length, 3) * 0.4) return null;
                return bestMatch;
            };

            lines.forEach((line, index) => {
                // Tenta separar por Tab (Excel padrão) ou Ponto e Vírgula
                let cols = line.split('\t');
                if (cols.length < 2) cols = line.split(';');
                
                // Esperado: ICT | CAMPUS | CATEGORIA | INICIO | FIM
                if (cols.length < 5) {
                    // Tenta ser flexível se faltar colunas, mas precisa de pelo menos Categoria e Datas
                    // Vamos assumir ordem estrita para simplificar
                    log.push(`Linha ${index + 1}: Colunas insuficientes (encontrado ${cols.length}, esperado 5).`);
                    errorCount++;
                    return;
                }

                let [rawIct, rawCampus, rawCategory, rawStart, rawEnd] = cols.map(c => c ? c.trim() : '');

                // 1. Parse Datas
                const parseDate = (d) => {
                    if (!d) return null;
                    // DD/MM/YYYY
                    if (d.includes('/')) {
                        const parts = d.split('/');
                        if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
                    }
                    // YYYY-MM-DD
                    if (d.includes('-')) return d;
                    return null;
                };

                const start = parseDate(rawStart);
                const end = parseDate(rawEnd);

                if (!start || !end) {
                    log.push(`Linha ${index + 1}: Datas inválidas (${rawStart} - ${rawEnd}).`);
                    errorCount++;
                    return;
                }

                // 2. Processa Categoria
                let category = rawCategory;
                // Capitalize first letter
                category = category.charAt(0).toUpperCase() + category.slice(1).toLowerCase();
                
                if (!this.categoryColors[category]) {
                    // Cria nova categoria com cor aleatória
                    const randomColor = '#' + Math.floor(Math.random()*16777215).toString(16);
                    this.categoryColors[category] = randomColor;
                    log.push(`Linha ${index + 1}: Nova categoria criada "${category}".`);
                }

                // 3. Identifica Escopo e Targets
                let scope = 'global';
                let targetIds = [];

                // Normaliza inputs
                const isAllIcts = !rawIct || rawIct.toLowerCase() === 'todas' || rawIct.toLowerCase() === 'todos';
                const isAllCampi = !rawCampus || rawCampus.toLowerCase() === 'todos' || rawCampus.toLowerCase() === 'todas' || rawCampus === '-';

                if (isAllIcts) {
                    scope = 'global';
                } else {
                    // Busca ICT
                    const allIctNames = this.consolidatedData.map(d => d.ictName);
                    const matchedIct = findBestMatch(rawIct, allIctNames);

                    if (!matchedIct) {
                        log.push(`Linha ${index + 1}: ICT "${rawIct}" não encontrada.`);
                        errorCount++;
                        return;
                    }

                    if (isAllCampi) {
                        scope = 'ict';
                        targetIds = [matchedIct];
                    } else {
                        // Busca Campus dentro da ICT encontrada
                        const campiOfIct = this.allCampiFromResponses.filter(c => c.ict === matchedIct);
                        const campusNames = campiOfIct.map(c => c.name);
                        
                        // Tenta match pelo nome
                        let matchedCampusName = findBestMatch(rawCampus, campusNames);
                        let matchedCampus = null;

                        if (matchedCampusName) {
                            matchedCampus = campiOfIct.find(c => c.name === matchedCampusName);
                        }

                        if (!matchedCampus) {
                            // Fallback: Se não achou campus específico, assume escopo ICT mas avisa
                            log.push(`Linha ${index + 1}: Campus "${rawCampus}" não encontrado em ${matchedIct}. Aplicando para toda a ICT.`);
                            scope = 'ict';
                            targetIds = [matchedIct];
                        } else {
                            scope = 'campus';
                            targetIds = [matchedCampus.id.toString()];
                        }
                    }
                }

                // 4. Cria Evento
                const newEvent = {
                    title: `${category} (${scope === 'global' ? 'Global' : (scope === 'ict' ? targetIds[0] : 'Campus')})`,
                    category: category,
                    start: start,
                    end: end,
                    scope: scope,
                    targetIds: targetIds,
                    color: this.categoryColors[category]
                };

                this.eventList.push(newEvent);
                successCount++;
            });

            this.processCalendar();
            this.saveEvents(true);

            this.importEventsError = errorCount > 0;
            this.importEventsMessage = `Processado com sucesso: ${successCount} eventos.\nErros/Avisos: ${errorCount}\n\nLog:\n${log.slice(0, 10).join('\n')}${log.length > 10 ? '\n...' : ''}`;
            
            if (successCount > 0) {
                this.importEventsText = ''; // Limpa se houve sucesso parcial
            }
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
                let ictsToProcess = this.consolidatedData;

                // Filtro por ICT específica ou Grupo
                if (this.calendarFilterIct) {
                    if (this.calendarFilterIct.startsWith('GROUP:')) {
                        const groupId = this.calendarFilterIct.split(':')[1];
                        const group = this.customGroups.find(g => g.id.toString() === groupId);
                        if (group && group.type === 'ict') {
                            ictsToProcess = ictsToProcess.filter(ict => group.items.includes(ict.ictName));
                        }
                    } else {
                        ictsToProcess = ictsToProcess.filter(ict => ict.ictName === this.calendarFilterIct);
                    }
                }

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
                                if (!event.start || !event.end) continue;

                                try {
                                    // Fix Timezone Issue: Parse YYYY-MM-DD as local date
                                    const startParts = event.start.split('T')[0].split('-');
                                    const [sy, sm, sd] = startParts.map(n => parseInt(n, 10));
                                    const eventStart = new Date(sy, sm - 1, sd).getTime();
                                    
                                    const endParts = event.end.split('T')[0].split('-');
                                    const [ey, em, ed] = endParts.map(n => parseInt(n, 10));
                                    const eventEnd = new Date(ey, em - 1, ed).setHours(23, 59, 59, 999);

                                    if (dayStart >= eventStart && dayStart <= eventEnd) {
                                        const scopeMatch = event.scope === 'global' ||
                                            (event.scope === 'ict' && event.targetIds && event.targetIds.includes(ict.ictName)) ||
                                            (event.scope === 'campus' && this.doesEventAffectIct(event, ict.ictName));

                                        if (scopeMatch) {
                                            isUnavailable = true;
                                            reason = event.title;
                                            break; 
                                        }
                                    }
                                } catch (err) {
                                    console.warn("Erro ao processar evento no calendário:", event, err);
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
                
                // Filtro por ICT (que filtra campi) ou Grupo de Campi
                if (this.calendarFilterIct) {
                    if (this.calendarFilterIct.startsWith('GROUP:')) {
                        const groupId = this.calendarFilterIct.split(':')[1];
                        const group = this.customGroups.find(g => g.id.toString() === groupId);
                        if (group) {
                            if (group.type === 'campus') {
                                campiToProcess = campiToProcess.filter(c => group.items.includes(c.id.toString()));
                            } else if (group.type === 'ict') {
                                campiToProcess = campiToProcess.filter(c => group.items.includes(c.ict));
                            }
                        }
                    } else {
                        campiToProcess = campiToProcess.filter(c => c.ict === this.calendarFilterIct);
                    }
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
                                if (!event.start || !event.end) continue;

                                try {
                                    // Fix Timezone Issue: Parse YYYY-MM-DD as local date
                                    const startParts = event.start.split('T')[0].split('-');
                                    const [sy, sm, sd] = startParts.map(n => parseInt(n, 10));
                                    const eventStart = new Date(sy, sm - 1, sd).getTime();
                                    
                                    const endParts = event.end.split('T')[0].split('-');
                                    const [ey, em, ed] = endParts.map(n => parseInt(n, 10));
                                    const eventEnd = new Date(ey, em - 1, ed).setHours(23, 59, 59, 999);

                                    if (dayStart >= eventStart && dayStart <= eventEnd) {
                                        const scopeMatch = 
                                            event.scope === 'global' ||
                                            (event.scope === 'ict' && event.targetIds && event.targetIds.includes(campus.ict)) ||
                                            (event.scope === 'campus' && event.targetIds && event.targetIds.includes(campus.id.toString()));
                                        
                                        if (scopeMatch) {
                                            isUnavailable = true;
                                            reason = event.title;
                                            break;
                                        }
                                    }
                                } catch (err) {
                                    console.warn("Erro ao processar evento no calendário (campus):", event, err);
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
            if (!event || !event.targetIds || !Array.isArray(event.targetIds)) return false;
            
            const campiOfIct = this.allCampiFromResponses
                .filter(c => c.ict === ictName)
                .map(c => c.id.toString());
            
            return event.targetIds.some(targetId => campiOfIct.includes(targetId));
        },

        getHeatClass(ratio) {
            if (ratio === 0) return 'bg-white border-slate-200';
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
            // Reset para o estado inicial válido para o Wizard Inline
            this.eventForm = { 
                title: '', category: 'Feriado', start: '', end: '',
                scope: 'global', targetIds: [], color: '#8b5cf6'
            };
            this.editingEventIndex = null;
            this.wizardSelectedIcts = [];
            this.wizardSelectedCampi = [];
        },
        submitEvent() {
            // Debug para identificar campos vazios
            console.log("Submitting event:", JSON.parse(JSON.stringify(this.eventForm)));
            
            if (!this.eventForm.start || !this.eventForm.end || !this.eventForm.category) {
                alert(`Preencha todos os campos básicos:\nCategoria: ${this.eventForm.category || 'Vazio'}\nInício: ${this.eventForm.start || 'Vazio'}\nFim: ${this.eventForm.end || 'Vazio'}`);
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
            this.saveEvents(true); // Auto-save silently
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
        submitInlineEvent() {
            // Validação
            if (!this.inlineEventForm.start || !this.inlineEventForm.end || !this.inlineEventForm.category) {
                alert(`Preencha todos os campos básicos:\nCategoria: ${this.inlineEventForm.category || 'Vazio'}\nInício: ${this.inlineEventForm.start || 'Vazio'}\nFim: ${this.inlineEventForm.end || 'Vazio'}`);
                return;
            }
            
            // Cria objeto de evento
            const newEvent = {
                title: '',
                category: this.inlineEventForm.category,
                start: this.inlineEventForm.start,
                end: this.inlineEventForm.end,
                scope: 'global',
                targetIds: [],
                color: this.categoryColors[this.inlineEventForm.category] || '#8b5cf6'
            };

            // Determina Escopo e TargetIds
            if (this.wizardSelectedIcts.length > 0 && this.wizardSelectedIcts[0] === 'ALL') {
                newEvent.scope = 'global';
                newEvent.targetIds = [];
            } else if (this.wizardSelectedCampi.length > 0) {
                newEvent.scope = 'campus';
                newEvent.targetIds = this.wizardSelectedCampi.map(c => c.id.toString());
            } else if (this.wizardSelectedIcts.length > 0) {
                newEvent.scope = 'ict';
                newEvent.targetIds = this.wizardSelectedIcts.map(i => i.ictName);
            } else {
                alert("Selecione pelo menos uma ICT ou 'Todas'.");
                return;
            }

            // Gera título automático
            let autoTitle = newEvent.category;
            if (newEvent.scope === 'ict') {
                if (newEvent.targetIds.length === 1) autoTitle += ` (${newEvent.targetIds[0]})`;
                else autoTitle += ` (${newEvent.targetIds.length} ICTs)`;
            } else if (newEvent.scope === 'campus') {
                if (newEvent.targetIds.length === 1) {
                    const c = this.allCampiFromResponses.find(x => x.id.toString() === newEvent.targetIds[0]);
                    if(c) autoTitle += ` (${c.name})`;
                } else {
                    autoTitle += ` (${newEvent.targetIds.length} Campi)`;
                }
            } else if (newEvent.scope === 'global') {
                autoTitle += ` (Global)`;
            }
            newEvent.title = autoTitle;

            // Adiciona à lista (no início para visibilidade)
            this.eventList.unshift(newEvent);
            
            // Limpa filtro para garantir que aparece
            this.eventListFilter = '';
            
            // Força atualização de reatividade
            this.eventList = [...this.eventList];
            
            console.log("Evento adicionado:", newEvent);
            console.log("Total eventos:", this.eventList.length);

            try {
                this.processCalendar();
                this.saveEvents(true); // Auto-save silently
            } catch (e) {
                console.error("Erro ao processar calendário:", e);
            }
            
            // Reset Wizard e Inline Form
            this.wizardSelectedIcts = [];
            this.wizardSelectedCampi = [];
            this.ictSearch = '';
            this.campusSearch = '';
            this.inlineEventForm = { 
                category: 'Feriado', start: '', end: ''
            };
            
            alert(`Evento adicionado com sucesso! Total de eventos na lista: ${this.eventList.length}`);
        },
        removeEvent(index) {
            if (confirm(`Tem certeza que deseja remover o evento "${this.eventList[index].title}"?`)) {
                this.eventList.splice(index, 1);
                this.processCalendar();
                this.saveEvents(true); // Auto-save silently
            }
        },
        
        // --- Bulk Actions ---
        toggleSelectAllEvents() {
            if (this.isAllEventsSelected) {
                this.selectedEvents = [];
            } else {
                this.selectedEvents = [...this.filteredEventList];
            }
        },
        deleteSelectedEvents() {
            if (this.selectedEvents.length === 0) return;
            
            if (confirm(`Tem certeza que deseja excluir ${this.selectedEvents.length} eventos selecionados?`)) {
                // Remove events that are in the selectedEvents array
                this.eventList = this.eventList.filter(evt => !this.selectedEvents.includes(evt));
                
                this.selectedEvents = [];
                this.processCalendar();
                this.saveEvents(true); // Auto-save silently
            }
        },
        exportEventsToCSV() {
            if (this.eventList.length === 0) return alert("Não há eventos para exportar.");

            const rows = [];

            this.eventList.forEach(evt => {
                const start = this.formatDate(evt.start); // DD/MM/YYYY
                const end = this.formatDate(evt.end);     // DD/MM/YYYY
                const category = evt.category;

                if (evt.scope === 'global') {
                    rows.push({ "ICT": "Todas", "Campus": "Todos", "Categoria": category, "Início": start, "Fim": end });
                } else if (evt.scope === 'ict') {
                    if (evt.targetIds.length === 0) {
                        rows.push({ "ICT": "?", "Campus": "Todos", "Categoria": category, "Início": start, "Fim": end });
                    } else {
                        evt.targetIds.forEach(ictName => {
                            rows.push({ "ICT": ictName, "Campus": "Todos", "Categoria": category, "Início": start, "Fim": end });
                        });
                    }
                } else if (evt.scope === 'campus') {
                    if (evt.targetIds.length === 0) {
                        rows.push({ "ICT": "?", "Campus": "?", "Categoria": category, "Início": start, "Fim": end });
                    } else {
                        evt.targetIds.forEach(campusId => {
                            const campus = this.allCampiFromResponses.find(c => c.id.toString() === campusId.toString());
                            if (campus) {
                                rows.push({ "ICT": campus.ict, "Campus": campus.name, "Categoria": category, "Início": start, "Fim": end });
                            } else {
                                rows.push({ "ICT": "?", "Campus": `ID:${campusId}`, "Categoria": category, "Início": start, "Fim": end });
                            }
                        });
                    }
                }
            });

            const ws = XLSX.utils.json_to_sheet(rows);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "Eventos");
            XLSX.writeFile(wb, `eventos_export_${new Date().toISOString().slice(0,10)}.xlsx`);
        },

        async saveEvents(silent = false) {
            if (!silent && !confirm("Isso irá substituir TODOS os eventos no calendário com a lista atual. Deseja continuar?")) return;
            this.saving = true;
            try {
                const { data, error } = await supabase.rpc('admin_update_calendar_events', {
                    admin_password: this.adminPassword,
                    all_events: this.eventList,
                    p_form_id: this.currentFormId
                });
                if (error) throw error;
                if (!silent) alert(data);
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

        // --- Métodos de Gestão de Grupos (Edital) ---
        async fetchEditalGroups() {
            if (!this.currentFormId) return;
            
            try {
                const { data, error } = await supabase.rpc('admin_get_edital_groups', {
                    p_form_id: this.currentFormId
                });
                if (error) throw error;
                this.editalGroups = data || [];
            } catch (e) {
                console.error("Erro ao buscar grupos:", e);
                alert("Erro ao carregar grupos.");
            }
        },

        async createEditalGroup() {
            if (!this.currentFormId) return alert("Selecione um Edital primeiro.");
            if (!this.newEditalGroup.name) return alert("Nome do grupo é obrigatório.");

            try {
                const { data, error } = await supabase.rpc('admin_create_group', {
                    admin_password: this.adminPassword,
                    p_form_id: this.currentFormId,
                    p_name: this.newEditalGroup.name
                });

                if (error) throw error;
                
                alert("Grupo criado com sucesso!");
                this.newEditalGroup.name = '';
                this.fetchEditalGroups();
            } catch (e) {
                console.error("Erro ao criar grupo:", e);
                alert("Erro ao criar grupo: " + e.message);
            }
        },

        async updateEditalGroup(group) {
            const newName = prompt("Novo nome do grupo:", group.name);
            if (!newName || newName === group.name) return;

            try {
                const { error } = await supabase.rpc('admin_update_group', {
                    admin_password: this.adminPassword,
                    p_group_id: group.id,
                    p_name: newName
                });

                if (error) throw error;
                this.fetchEditalGroups();
            } catch (e) {
                console.error("Erro ao atualizar grupo:", e);
                alert("Erro ao atualizar grupo: " + e.message);
            }
        },

        async deleteEditalGroup(group) {
            if (!confirm(`Tem certeza que deseja excluir o grupo "${group.name}"?`)) return;

            try {
                const { error } = await supabase.rpc('admin_delete_group', {
                    admin_password: this.adminPassword,
                    p_group_id: group.id
                });

                if (error) throw error;
                this.fetchEditalGroups();
            } catch (e) {
                console.error("Erro ao excluir grupo:", e);
                alert("Erro ao excluir grupo: " + e.message);
            }
        },

        async addEditalGroupMember(groupId) {
            const selection = this.newGroupMember[groupId];
            if (!selection) return;

            // selection pode ser um objeto (novo) ou ID (legado/fallback)
            const ictId = selection.id || selection;
            const campusName = selection.campus || null;

            try {
                const { error } = await supabase.rpc('admin_add_group_member', {
                    admin_password: this.adminPassword,
                    p_group_id: groupId,
                    p_ict_portal_id: ictId,
                    p_campus_name: campusName
                });

                if (error) throw error;
                
                this.newGroupMember[groupId] = null;
                this.fetchEditalGroups();
            } catch (e) {
                console.error("Erro ao adicionar membro:", e);
                alert("Erro ao adicionar membro: " + e.message);
            }
        },

        async removeGroupMemberByIds(groupId, membershipId) {
            if (!confirm('Remover esta instituição do grupo?')) return;

            try {
                const { error } = await supabase.rpc('admin_remove_group_member', {
                    admin_password: this.adminPassword,
                    p_membership_id: membershipId
                });

                if (error) throw error;
                this.fetchEditalGroups();
            } catch (e) {
                console.error("Erro ao remover membro:", e);
                alert("Erro ao remover membro: " + e.message);
            }
        },

        async addEditalGroupSupervisor(groupId) {
            const specialistId = this.newGroupSupervisor[groupId];
            if (!specialistId) return;

            try {
                const { error } = await supabase.rpc('admin_add_group_supervisor', {
                    admin_password: this.adminPassword,
                    p_group_id: groupId,
                    p_specialist_id: specialistId
                });

                if (error) throw error;
                
                this.newGroupSupervisor[groupId] = null;
                this.fetchEditalGroups();
            } catch (e) {
                console.error("Erro ao adicionar supervisor:", e);
                alert("Erro ao adicionar supervisor: " + e.message);
            }
        },

        // --- UI Helpers ---
        getScopeIcon(scope) {
            const icons = { 'global': 'fa-globe', 'ict': 'fa-building-columns', 'campus': 'fa-school' };
            return icons[scope] || 'fa-question-circle';
        },
        getScopeLabel(evt) {
            if (!evt || !evt.scope) return 'N/D';
            if (evt.scope === 'global') return 'Global';
            
            const targets = this.getEventTargets(evt);
            if (targets.length === 0) return 'Nenhum selecionado';
            
            if (targets.length <= 3) {
                return targets.join(', ');
            }
            return `${targets.length} ${evt.scope === 'ict' ? 'ICTs' : 'Campi'} (${targets.slice(0, 2).join(', ')}...)`;
        },
        getEventTargets(evt) {
            if (!evt || !evt.targetIds) return [];
            if (evt.scope === 'ict') return evt.targetIds;
            if (evt.scope === 'campus') {
                return evt.targetIds.map(id => {
                    const c = this.allCampiFromResponses.find(x => x.id.toString() === id.toString());
                    return c ? c.name : id;
                });
            }
            return [];
        },
        formatDate(dateString) {
            if (!dateString) return '';
            // Handle ISO strings (YYYY-MM-DDTHH:mm:ss...)
            if (dateString.includes('T')) {
                dateString = dateString.split('T')[0];
            }
            const [year, month, day] = dateString.split('-');
            return `${day}/${month}/${year}`;
        },

        handleClickOutside(event) {
            if (!event.target.closest('.relative.group')) {
                this.showIctDropdown = false;
                this.showCampusDropdown = false;
            }
        },

        // --- Chat Admin ---
        async loadChatChannels() {
            try {
                const { data, error } = await supabase
                    .from('chat_channels')
                    .select('*')
                    .order('name');
                
                if (error) throw error;
                this.chatChannels = data.map(c => ({...c, unread: 0}));
            } catch (e) {
                console.error("Chat init error:", e);
                // Fallback
                this.chatChannels = [
                    { id: 1, name: 'Geral', type: 'general', unread: 0 },
                    { id: 2, name: 'Dúvidas', type: 'help', unread: 0 },
                    { id: 3, name: 'Sugestões', type: 'ideas', unread: 0 }
                ];
            }
        },

        async selectChannel(channel) {
            this.currentChannel = channel;
            this.chatMessages = [];
            await this.loadChatMessages(channel.id);
            this.subscribeToChat(channel.id);
        },

        async loadChatMessages(channelId) {
            const { data, error } = await supabase
                .from('chat_messages')
                .select('*')
                .eq('channel_id', channelId)
                .order('created_at', { ascending: true })
                .limit(100);

            if (error) {
                console.warn("Could not load messages");
                return;
            }

            this.chatMessages = data.map(msg => ({
                ...msg,
                isMe: msg.sender_name === 'Admin', // Identify admin messages
                senderInitials: (msg.sender_name || '?').substring(0, 2).toUpperCase(),
                senderName: msg.sender_name
            }));
            
            this.scrollToBottom();
        },

        async sendMessage() {
            if (!this.newMessage.trim() || !this.currentChannel) return;

            const msgContent = this.newMessage.trim();
            this.newMessage = ''; // Clear immediately

            const { error } = await supabase
                .from('chat_messages')
                .insert({
                    channel_id: this.currentChannel.id,
                    content: msgContent,
                    sender_name: 'Admin', // Hardcoded for Admin Console
                    portal_id: null // Null for Admin
                });

            if (error) {
                console.error("Send error:", error);
                alert("Erro ao enviar mensagem.");
                this.newMessage = msgContent; // Restore
            }
        },

        async deleteMessage(msg) {
            if (!confirm("Tem certeza que deseja excluir esta mensagem?")) return;

            const { error } = await supabase
                .from('chat_messages')
                .delete()
                .eq('id', msg.id);

            if (error) {
                alert("Erro ao excluir mensagem: " + error.message);
            } else {
                // Remove from local list immediately
                this.chatMessages = this.chatMessages.filter(m => m.id !== msg.id);
            }
        },

        async createChannel() {
            if (!this.newChannel.name) return;
            
            const { data, error } = await supabase
                .from('chat_channels')
                .insert(this.newChannel)
                .select();

            if (error) {
                alert("Erro ao criar canal: " + error.message);
            } else {
                this.chatChannels.push(data[0]);
                this.showNewChannelModal = false;
                this.newChannel = { name: '', type: 'general', description: '' };
            }
        },

        async deleteChannel(channel) {
            if (!confirm(`Excluir o canal "${channel.name}" e todas as mensagens?`)) return;

            const { error } = await supabase
                .from('chat_channels')
                .delete()
                .eq('id', channel.id);

            if (error) {
                alert("Erro ao excluir canal: " + error.message);
            } else {
                this.chatChannels = this.chatChannels.filter(c => c.id !== channel.id);
                if (this.currentChannel && this.currentChannel.id === channel.id) {
                    this.currentChannel = null;
                    this.chatMessages = [];
                }
            }
        },

        subscribeToChat(channelId) {
            if (this.chatSubscription) {
                supabase.removeChannel(this.chatSubscription);
            }

            this.chatSubscription = supabase
                .channel(`public:chat_messages:channel_id=eq.${channelId}`)
                .on('postgres_changes', { 
                    event: '*', // Listen to all events (INSERT, DELETE)
                    schema: 'public', 
                    table: 'chat_messages', 
                    filter: `channel_id=eq.${channelId}` 
                }, payload => {
                    if (payload.eventType === 'INSERT') {
                        const newMsg = payload.new;
                        this.chatMessages.push({
                            ...newMsg,
                            isMe: newMsg.sender_name === 'Admin',
                            senderInitials: (newMsg.sender_name || '?').substring(0, 2).toUpperCase(),
                            senderName: newMsg.sender_name
                        });
                        this.scrollToBottom();
                    } else if (payload.eventType === 'DELETE') {
                        this.chatMessages = this.chatMessages.filter(m => m.id !== payload.old.id);
                    }
                })
                .subscribe();
        },

        getChannelIcon(type) {
            const map = {
                'general': 'fa-hashtag',
                'help': 'fa-circle-question',
                'ideas': 'fa-lightbulb',
                'announcements': 'fa-bullhorn'
            };
            return map[type] || 'fa-hashtag';
        },

        getChannelDescription(type) {
            const map = {
                'general': 'Discussões gerais',
                'help': 'Dúvidas dos usuários',
                'ideas': 'Sugestões',
                'announcements': 'Comunicados'
            };
            return map[type] || 'Canal de discussão';
        },

        formatTime(isoString) {
            if (!isoString) return '';
            const date = new Date(isoString);
            return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        },

        scrollToBottom() {
            const container = document.getElementById('adminChatMessagesContainer');
            if (container) {
                setTimeout(() => {
                    container.scrollTop = container.scrollHeight;
                }, 50);
            }
        },

        // --- Specialist Management ---

        async fetchSpecialists() {
            try {
                // Tentar via RPC primeiro (legado) ou direto se falhar
                const { data, error } = await supabase.rpc('admin_get_specialists', { 
                    admin_password: this.adminPassword 
                });
                
                if (!error) {
                    this.specialistsList = data;
                } else {
                    // Fallback para select direto (caso a RPC não exista ou falhe)
                    const { data: directData, error: directError } = await supabase
                        .from('specialists')
                        .select('*')
                        .order('name');
                    
                    if (directError) throw directError;
                    this.specialistsList = directData || [];
                }

                if (this.adminTab === 'specialists_dashboard') {
                    this.renderSpecialistChart();
                }
            } catch (err) {
                console.error('Erro ao buscar especialistas:', err);
            }
        },



        async createSpecialist() {
            if (!this.newSpecialist.name || !this.newSpecialist.email) {
                alert('Preencha nome e email.');
                return;
            }
            
            try {
                const { data, error } = await supabase.rpc('admin_create_specialist', {
                    admin_password: this.adminPassword,
                    p_name: this.newSpecialist.name,
                    p_email: this.newSpecialist.email,
                    p_specialty: this.newSpecialist.specialty
                });

                if (error) throw error;

                alert(`Especialista criado!\nChave de Acesso: ${data.access_key}`);
                this.showSpecialistModal = false;
                this.newSpecialist = { name: '', email: '', specialty: '' };
                this.fetchSpecialists();

            } catch (err) {
                console.error(err);
                alert('Erro ao criar especialista: ' + err.message);
            }
        },

        async viewSpecialistReports(specialist) {
            this.selectedSpecialistName = specialist.name;
            this.currentSpecialistReports = [];
            this.showSpecialistReportsModal = true;

            try {
                const { data, error } = await supabase.rpc('admin_get_specialist_reports', {
                    admin_password: this.adminPassword,
                    p_specialist_id: specialist.id
                });

                if (error) throw error;
                this.currentSpecialistReports = data;

            } catch (err) {
                console.error(err);
                alert('Erro ao carregar relatórios: ' + err.message);
            }
        }
    },
    mounted() {
        document.addEventListener('click', this.handleClickOutside);

        // Check for saved session
        const savedPwd = localStorage.getItem('assistec_admin_session_pwd');
        const savedExp = localStorage.getItem('assistec_admin_session_exp');

        if (savedPwd && savedExp) {
            if (Date.now() < parseInt(savedExp)) {
                this.adminPassword = savedPwd;
                this.checkLogin();
            } else {
                localStorage.removeItem('assistec_admin_session_pwd');
                localStorage.removeItem('assistec_admin_session_exp');
            }
        }
    },
    beforeUnmount() {
        document.removeEventListener('click', this.handleClickOutside);
    }
}).mount('#adminApp');
