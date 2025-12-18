/* --- portal.js --- */
const { createApp } = Vue;
const supabase = window.supabaseClient;

createApp({
    data() {
        return {
            currentView: 'login', // 'login' ou 'dashboard'
            loginMode: 'institution', // 'institution' ou 'specialist'
            loading: false,
            accessKey: '',
            loginError: false,
            
            // Estrutura de dados
            portalInfo: null,  // Dados da tabela ict_portals
            latestResponse: null, // Dados da submissão mais recente (para lista de campi)
            currentForm: null,
            eventList: [], 
            
            saving: false,

            // Modal de Evento
            showEventModal: false,
            showReportModal: false,
            eventForm: {},
            editingEventIndex: null,
            
            categoryColors: {
                'Recesso': '#f97316', 'Férias': '#3b82f6', 'Feriado': '#8b5cf6', 
                'Greve': '#ef4444', 'Outro': '#64748b'
            },

            // Estado do Calendário
            calendarYear: new Date().getFullYear(),
            calendarMonths: [],
            showDayModal: false,
            selectedDay: null,

            // Gestão de Equipe
            activeTab: 'calendar',
            teamList: [],
            teamForm: {},
            showTeamModal: false,
            loadingTeam: false,

            // Repositório de Documentos
            docList: [],
            showDocModal: false,
            docForm: { name: '', file: null },
            loadingDocs: false,
            uploading: false,

            // Chat / Comunidade
            chatChannels: [],
            currentChannel: null,
            chatMessages: [],
            newMessage: '',
            chatSubscription: null,

            // --- Specialist Data ---
            specialist: null,
            specialistProjects: [], // Projetos do especialista
            specialistReports: [],
            showReportModal: false,
            activeReportTab: 'diary', // planning, diary, closing
            currentReport: {},
            
            // Kanban (Main View)
            kanbanCards: [],
            selectedEditalId: null, // Agora armazena o group_id
            availableForms: [],
            kanbanSubscription: null,
            
            // Kanban Modal
            showKanbanModal: false,
            kanbanForm: {
                id: null,
                title: '',
                description: '',
                priority: 'medium',
                assignee: '',
                status: 'todo'
            },
            
            // Log Modal
            showLogModal: false,
            currentLogIndex: null,
            logForm: {
                date: '',
                type: 'Reunião Online',
                participants: '',
                themes: '',
                next_steps: '',
                evidences: [] // { name, url, type }
            },
            uploadingLogEvidence: false,

            reportForm: {
                title: '',
                period: '',
                demand_type: 'Prioritária',
                theme_area: '',
                diagnostic_summary: '',
                institutional_problem: '',
                general_objective: '',
                action_plan: [], 
                kanban_data: [], // Novo campo para o Kanban
                products_types: [],
                products_description: '',
                impact_analysis: '',
                challenges: '',
                conclusion: '',
                attendance_logs: []
            }
        }
    },
    watch: {
        calendarYear() { this.processCalendar(); },
        eventList: {
            handler() { this.processCalendar(); },
            deep: true
        },
        activeTab(newVal) {
            if (newVal === 'community' && this.chatChannels.length === 0) {
                this.loadChatChannels();
            }
        },
        chatMessages() {
            this.$nextTick(() => {
                this.scrollToBottom();
            });
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
        },
        reportStats() {
            if (!this.eventList) return { total: 0, byCategory: {} };
            const total = this.eventList.length;
            const byCategory = {};
            this.eventList.forEach(e => {
                byCategory[e.category] = (byCategory[e.category] || 0) + 1;
            });
            return { total, byCategory };
        }
    },
    methods: {
        formatDateBR(val) { return window.formatDateBR(val); },

        // --- Login (Refatorado para RPC) ---
        async loginWithKey() {
            if (!this.accessKey) return;
            this.loading = true;
            this.loginError = false;

            // SPECIALIST LOGIN
            if (this.loginMode === 'specialist') {
                try {
                    const { data, error } = await supabase.rpc('get_specialist_data', { 
                        p_access_key: this.accessKey.trim() 
                    });

                    if (error) throw error;

                    this.specialist = data.specialist;
                    this.specialistReports = data.reports;
                    
                    // Carregar Projetos (Grupos)
                    await this.loadSpecialistProjects();
                    await this.fetchAvailableForms();

                    localStorage.setItem('specialist_key', this.accessKey.trim());
                    this.currentView = 'specialist_dashboard';
                    return;

                } catch (e) {
                    console.error(e);
                    this.loginError = true;
                    this.loading = false;
                    return;
                }
            }

            // INSTITUTION LOGIN (Standard)
            try {
                const { data, error } = await supabase.rpc('get_portal_data_with_key', {
                    p_access_key: this.accessKey.trim()
                });

                if (error) throw error;

                this.portalInfo = data.portal;
                this.latestResponse = data.response;
                this.currentForm = data.form; // <-- NOVO
                
                await this.fetchUserEvents();
                await this.fetchTeam();
                await this.fetchDocuments();
                this.fetchCategories(); // Load global categories
                
                // Save session
                const expiry = Date.now() + (24 * 60 * 60 * 1000); // 24 hours
                localStorage.setItem('assistec_portal_key', this.accessKey);
                localStorage.setItem('assistec_portal_exp', expiry.toString());

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
            
            // Clear Specialist
            this.specialist = null;
            this.specialistReports = [];
            localStorage.removeItem('specialist_key');
            
            this.accessKey = '';
            this.currentView = 'login';
        },

        async loadSpecialistProjects() {
            try {
                // Agora busca o portfólio baseado em grupos
                const { data, error } = await supabase
                    .rpc('get_specialist_portfolio', { p_specialist_id: this.specialist.id });

                if (error) throw error;
                
                // Mapear para o formato esperado pelo select
                // A RPC retorna: { group_id, group_name, edital_title, role, ict: { id, name } }
                this.specialistProjects = (data || []).map(item => ({
                    project: {
                        id: item.ict.id,
                        ict_name: item.ict.name,
                        group_name: item.group_name,
                        edital: item.edital_title,
                        group_id: item.group_id
                    },
                    role: item.role
                }));
            } catch (err) {
                console.error('Erro ao carregar projetos:', err);
            }
        },

        // --- Gestão de Eventos (Refatorado para RPC) ---
        async fetchUserEvents() {
            try {
                const { data, error } = await supabase.rpc('get_events_for_portal', {
                    p_access_key: this.accessKey.trim()
                });
                if (error) throw error;
                this.eventList = data || [];
                this.processCalendar(); // <-- Atualiza o calendário
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
                    title: 'Recesso', category: 'Recesso', newCategory: '', start: '', end: '',
                    scope: 'all', targetIds: []
                };
            }
            this.showEventModal = true;
        },
        updateEventTitle() {
            // Deprecated: Title is now auto-set on submit or watch
            this.eventForm.title = this.eventForm.category;
        },
        closeEventModal() {
            this.showEventModal = false;
            this.eventForm = {};
            this.editingEventIndex = null;
        },
        submitEvent() {
            if (!this.eventForm.start || !this.eventForm.end) {
                alert("Preencha data de início e fim."); return;
            }
            
            // Force title to be the category name
            this.eventForm.title = this.eventForm.category;

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
                // Filtra eventos globais para não reenviá-los como locais
                const eventsToSave = this.eventList.filter(e => e.scope !== 'global');

                const { error } = await supabase.rpc('partner_update_events', {
                    p_access_key: this.accessKey.trim(),
                    p_user_events: eventsToSave
                });

                if (error) throw error;
                
                alert("Eventos salvos com sucesso!");

            } catch (e) {
                alert("Erro ao salvar: " + e.message);
            } finally {
                this.saving = false;
            }
        },

        // Lógica do Calendário
        generateCalendar(year, monthCount) {
            const months = [];
            let currentDate = new Date(year, 0, 1);

            for (let i = 0; i < monthCount; i++) {
                const monthName = currentDate.toLocaleString('pt-BR', { month: 'long' });
                const monthDays = [];
                const daysInMonth = new Date(year, currentDate.getMonth() + 1, 0).getDate();
                const firstDayOfWeek = new Date(year, currentDate.getMonth(), 1).getDay();

                for (let j = 0; j < firstDayOfWeek; j++) {
                    monthDays.push({ empty: true });
                }

                for (let day = 1; day <= daysInMonth; day++) {
                    monthDays.push({
                        day: day,
                        date: new Date(year, currentDate.getMonth(), day),
                        dateFmt: `${day}/${currentDate.getMonth() + 1}/${year}`,
                        stats: { total: 0, unavailableCount: 0, ratio: 0, heatClass: '' },
                        unavailableItems: []
                    });
                }
                months.push({ name: monthName, days: monthDays });
                currentDate.setMonth(currentDate.getMonth() + 1);
            }
            this.calendarMonths = months;
        },

        processCalendar() {
            this.generateCalendar(this.calendarYear, 12);
            
            if (!this.currentUser || !this.currentUser.campi) return;
            
            const totalCampi = this.currentUser.campi.length;
            if (totalCampi === 0) return;

            this.calendarMonths.forEach(month => {
                month.days.forEach(day => {
                    if (day.empty) return;

                    day.stats = { total: totalCampi, unavailableCount: 0, ratio: 0, heatClass: '' };
                    day.unavailableItems = [];
                    const dayStart = day.date.setHours(0, 0, 0, 0);

                    this.currentUser.campi.forEach(campus => {
                        let isUnavailable = false;
                        let reason = '';

                        for (const event of this.eventList) {
                            const eventStart = new Date(event.start).getTime();
                            const eventEnd = new Date(event.end).getTime();

                            if (dayStart >= eventStart && dayStart <= eventEnd) {
                                // Verifica se o evento afeta este campus
                                const scopeMatch = 
                                    event.scope === 'global' ||
                                    (event.scope === 'ict') || // Se é ICT, afeta todos os campi desta ICT
                                    (event.scope === 'all') || // Alias para ICT no portal
                                    (event.scope === 'campus' && event.targetIds.includes(campus.id.toString())) ||
                                    (event.scope === 'specific' && event.targetIds.includes(campus.id.toString())); // Alias para campus no portal

                                if (scopeMatch) {
                                    isUnavailable = true;
                                    reason = event.title;
                                    break;
                                }
                            }
                        }

                        if (isUnavailable) {
                            day.unavailableItems.push({ name: campus.name, reason });
                        }
                    });

                    day.stats.unavailableCount = day.unavailableItems.length;
                    day.stats.ratio = totalCampi > 0 ? day.stats.unavailableCount / totalCampi : 0;
                    day.stats.heatClass = this.getHeatClass(day.stats.ratio);
                });
            });
        },

        getHeatClass(ratio) {
            if (ratio >= 0.8) return 'bg-red-100 border-red-200 text-red-700';
            if (ratio >= 0.4) return 'bg-orange-100 border-orange-200 text-orange-700';
            if (ratio >= 0.1) return 'bg-yellow-100 border-yellow-200 text-yellow-700';
            return 'bg-emerald-50 border-emerald-100 text-emerald-700';
        },

        openDayDetails(day) {
            if (day.empty) return;
            this.selectedDay = day;
            this.showDayModal = true;
        },

        // --- Gestão de Equipe ---
        async fetchTeam() {
            this.loadingTeam = true;
            try {
                const { data, error } = await supabase.rpc('get_team_members', {
                    p_access_key: this.accessKey.trim()
                });
                if (error) throw error;
                this.teamList = data || [];
            } catch (e) {
                console.error("Erro ao carregar equipe:", e);
            } finally {
                this.loadingTeam = false;
            }
        },
        openTeamModal(member = null) {
            const standardRoles = ['Coordenador', 'Financeiro', 'Técnico', 'Administrativo'];
            
            if (member) {
                this.teamForm = { ...member };
                if (!standardRoles.includes(member.role)) {
                    this.teamForm.customRole = member.role;
                    this.teamForm.role = 'Outro';
                } else {
                    this.teamForm.customRole = '';
                }
            } else {
                this.teamForm = { name: '', role: 'Coordenador', customRole: '', email: '', phone: '' };
            }
            this.showTeamModal = true;
        },
        async saveTeamMember() {
            if (!this.teamForm.name) {
                alert("Nome é obrigatório."); return;
            }

            // Prepare payload
            const payload = { ...this.teamForm };
            
            // Handle Custom Role
            if (payload.role === 'Outro') {
                if (!payload.customRole || !payload.customRole.trim()) {
                    alert("Por favor, especifique a função.");
                    return;
                }
                // Normalize: Capitalize first letter
                payload.role = payload.customRole.trim().charAt(0).toUpperCase() + payload.customRole.trim().slice(1);
            }
            
            const action = this.teamForm.id ? 'update' : 'create';
            
            try {
                const { data, error } = await supabase.rpc('manage_team_member', {
                    p_access_key: this.accessKey.trim(),
                    p_member_data: payload,
                    p_action: action
                });

                if (error) throw error;
                
                alert(data);
                this.showTeamModal = false;
                this.fetchTeam();

            } catch (e) {
                alert("Erro ao salvar membro: " + e.message);
            }
        },
        async deleteTeamMember(member) {
            if (!confirm(`Tem certeza que deseja remover ${member.name}?`)) return;
            
            try {
                const { data, error } = await supabase.rpc('manage_team_member', {
                    p_access_key: this.accessKey.trim(),
                    p_member_data: member,
                    p_action: 'delete'
                });

                if (error) throw error;
                
                alert(data);
                this.fetchTeam();

            } catch (e) {
                alert("Erro ao remover membro: " + e.message);
            }
        },

        // --- Repositório de Documentos ---
        async fetchDocuments() {
            this.loadingDocs = true;
            try {
                const { data, error } = await supabase.rpc('get_documents', {
                    p_access_key: this.accessKey.trim()
                });
                if (error) throw error;
                this.docList = data || [];
            } catch (e) {
                console.error("Erro ao carregar documentos:", e);
            } finally {
                this.loadingDocs = false;
            }
        },
        openDocModal() {
            this.docForm = { name: '', file: null };
            this.showDocModal = true;
        },
        handleFileSelect(event) {
            const file = event.target.files[0];
            if (file) {
                this.docForm.file = file;
                if (!this.docForm.name) {
                    this.docForm.name = file.name;
                }
            }
        },
        async uploadDocument() {
            if (!this.docForm.file) return alert("Selecione um arquivo.");
            if (!this.docForm.name) return alert("Informe um nome para o documento.");

            this.uploading = true;
            try {
                const file = this.docForm.file;
                const fileExt = file.name.split('.').pop();
                const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
                
                // Sanitize folder name to avoid "Invalid Key" errors in Storage
                const folderName = this.portalInfo.ict_name
                    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
                    .replace(/[^a-zA-Z0-9]/g, "_"); // Replace non-alphanumeric with underscore
                
                const filePath = `${folderName}/${fileName}`;

                // 1. Upload to Storage
                const { data: storageData, error: storageError } = await supabase.storage
                    .from('portal-documents')
                    .upload(filePath, file);

                if (storageError) throw storageError;

                // 2. Get Public URL
                const { data: { publicUrl } } = supabase.storage
                    .from('portal-documents')
                    .getPublicUrl(filePath);

                // 3. Save Metadata to DB
                const { error: dbError } = await supabase.rpc('add_document_metadata', {
                    p_access_key: this.accessKey.trim(),
                    p_name: this.docForm.name,
                    p_file_path: publicUrl,
                    p_file_type: file.type,
                    p_size: file.size
                });

                if (dbError) throw dbError;

                alert("Documento enviado com sucesso!");
                this.showDocModal = false;
                this.fetchDocuments();

            } catch (e) {
                console.error(e);
                alert("Erro ao enviar documento: " + (e.message || "Verifique se o bucket 'portal-documents' existe e é público."));
            } finally {
                this.uploading = false;
            }
        },
        async deleteDocument(doc) {
            if (!confirm(`Tem certeza que deseja excluir ${doc.name}?`)) return;
            
            try {
                // 1. Delete from DB
                const { error: dbError } = await supabase.rpc('delete_document', {
                    p_access_key: this.accessKey.trim(),
                    p_document_id: doc.id
                });

                if (dbError) throw dbError;

                // 2. Delete from Storage (Optional - requires parsing path from URL)
                // For simplicity, we just remove the reference. 
                // To delete from storage, we'd need the relative path, not the full URL.
                // Let's try to extract it if possible, or just leave it.
                // const relativePath = doc.file_path.split('/storage/v1/object/public/portal-documents/')[1];
                // if (relativePath) await supabase.storage.from('portal-documents').remove([relativePath]);

                alert("Documento removido com sucesso!");
                this.fetchDocuments();

            } catch (e) {
                alert("Erro ao remover documento: " + e.message);
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

        // --- Chat / Comunidade ---
        async loadChatChannels() {
            try {
                const { data, error } = await supabase
                    .from('chat_channels')
                    .select('*')
                    .order('name');
                
                if (error || !data || data.length === 0) {
                    // Fallback / Default channels if table empty or missing
                    this.chatChannels = [
                        { id: 1, name: 'Geral', type: 'general', unread: 0 },
                        { id: 2, name: 'Dúvidas', type: 'help', unread: 0 },
                        { id: 3, name: 'Sugestões', type: 'ideas', unread: 0 }
                    ];
                } else {
                    this.chatChannels = data.map(c => ({...c, unread: 0}));
                }
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
            // If using mock channels (id < 100), don't fetch from DB yet if table doesn't exist
            // But let's try anyway.
            const { data, error } = await supabase
                .from('chat_messages')
                .select('*')
                .eq('channel_id', channelId)
                .order('created_at', { ascending: true })
                .limit(50);

            if (error) {
                console.warn("Could not load messages (tables might be missing)");
                return;
            }

            this.chatMessages = data.map(msg => ({
                ...msg,
                isMe: msg.portal_id === this.portalInfo.id, // Use ID for robust check
                senderInitials: (msg.sender_name || '?').substring(0, 2).toUpperCase(),
                senderName: msg.sender_name
            }));
            
            this.scrollToBottom();
        },

        async sendMessage() {
            if (!this.newMessage.trim() || !this.currentChannel) return;

            const msgContent = this.newMessage.trim();
            this.newMessage = ''; // Clear immediately

            // Include ICT in sender name
            const senderName = `${this.currentUser.name} (${this.currentUser.ict})`;

            const { error } = await supabase
                .from('chat_messages')
                .insert({
                    channel_id: this.currentChannel.id,
                    content: msgContent,
                    sender_name: senderName,
                    portal_id: this.portalInfo.id
                });

            if (error) {
                console.error("Send error:", error);
                alert("Erro ao enviar mensagem. Verifique se o chat está habilitado.");
                this.newMessage = msgContent; // Restore
            }
        },

        subscribeToChat(channelId) {
            if (this.chatSubscription) {
                supabase.removeChannel(this.chatSubscription);
            }

            this.chatSubscription = supabase
                .channel(`public:chat_messages:channel_id=eq.${channelId}`)
                .on('postgres_changes', { 
                    event: 'INSERT', 
                    schema: 'public', 
                    table: 'chat_messages', 
                    filter: `channel_id=eq.${channelId}` 
                }, payload => {
                    const newMsg = payload.new;
                    this.chatMessages.push({
                        ...newMsg,
                        isMe: newMsg.portal_id === this.portalInfo.id,
                        senderInitials: (newMsg.sender_name || '?').substring(0, 2).toUpperCase(),
                        senderName: newMsg.sender_name
                    });
                    this.scrollToBottom();
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
                'general': 'Discussões gerais sobre o censo',
                'help': 'Tire suas dúvidas aqui',
                'ideas': 'Sugestões para melhorias',
                'announcements': 'Comunicados importantes'
            };
            return map[type] || 'Canal de discussão';
        },

        formatTime(isoString) {
            if (!isoString) return '';
            const date = new Date(isoString);
            return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        },

        scrollToBottom() {
            const container = document.getElementById('chatMessagesContainer');
            if (container) {
                // Use setTimeout to ensure DOM update
                setTimeout(() => {
                    container.scrollTop = container.scrollHeight;
                }, 50);
            }
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
                console.error("Erro ao carregar categorias:", e);
            }
        },

        // --- Specialist Methods ---

        openReportModal(report = null, tab = 'planning') {
            this.activeReportTab = tab;
            if (report) {
                this.currentReport = report;
                this.reportForm = JSON.parse(JSON.stringify(report.content));
                // Garantir compatibilidade com versões antigas
                if (!this.reportForm.action_plan) this.reportForm.action_plan = [];
                if (!this.reportForm.attendance_logs) this.reportForm.attendance_logs = [];
                if (!this.reportForm.products_types) this.reportForm.products_types = [];
                this.reportForm.ict_portal_id = report.ict_portal_id; // Carregar ID do projeto
            } else {
                this.currentReport = {};
                this.reportForm = {
                    title: '',
                    period: '',
                    demand_type: 'Prioritária',
                    theme_area: '',
                    diagnostic_summary: '',
                    institutional_problem: '',
                    general_objective: '',
                    action_plan: [],
                    products_types: [],
                    products_description: '',
                    impact_analysis: '',
                    challenges: '',
                    conclusion: '',
                    attendance_logs: [],
                    ict_portal_id: null // Novo relatório começa sem projeto selecionado
                };
            }
            this.showReportModal = true;
        },

        closeReportModal() {
            this.showReportModal = false;
            this.resetReportForm();
        },

        resetReportForm() {
            this.reportForm = {
                title: '',
                period: '',
                demand_type: 'Prioritária',
                theme_area: '',
                diagnostic_summary: '',
                institutional_problem: '',
                general_objective: '',
                action_plan: [],
                products_types: [],
                products_description: '',
                impact_analysis: '',
                challenges: '',
                conclusion: '',
                attendance_logs: []
            };
        },

        addPlanRow() {
            this.reportForm.action_plan.push({ action: '', description: '', month: '', obs: '' });
        },
        removePlanRow(index) {
            this.reportForm.action_plan.splice(index, 1);
        },

        addLogRow() {
            this.currentLogIndex = null;
            this.logForm = {
                date: new Date().toISOString().split('T')[0],
                type: 'Reunião Online',
                participants: '',
                themes: '',
                next_steps: '',
                evidences: []
            };
            this.showLogModal = true;
        },
        
        editLogRow(index) {
            this.currentLogIndex = index;
            // Deep copy to avoid direct mutation before save
            this.logForm = JSON.parse(JSON.stringify(this.reportForm.attendance_logs[index]));
            if (!this.logForm.evidences) this.logForm.evidences = [];
            this.showLogModal = true;
        },

        saveLogEntry() {
            if (!this.logForm.date || !this.logForm.participants) {
                alert("Preencha a data e os participantes.");
                return;
            }

            if (this.currentLogIndex === null) {
                this.reportForm.attendance_logs.push({ ...this.logForm });
            } else {
                this.reportForm.attendance_logs[this.currentLogIndex] = { ...this.logForm };
            }
            this.showLogModal = false;
        },

        removeLogRow(index) {
            if(confirm("Remover este registro?")) {
                this.reportForm.attendance_logs.splice(index, 1);
            }
        },

        async uploadLogEvidence(event) {
            const file = event.target.files[0];
            if (!file) return;

            this.uploadingLogEvidence = true;
            try {
                const fileExt = file.name.split('.').pop();
                const fileName = `evidence_${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
                const folderName = 'specialist_evidence';
                const filePath = `${folderName}/${fileName}`;

                // 1. Upload to Storage (using same bucket 'portal-documents' or similar)
                const { data: storageData, error: storageError } = await supabase.storage
                    .from('portal-documents')
                    .upload(filePath, file);

                if (storageError) throw storageError;

                // 2. Get Public URL
                const { data: { publicUrl } } = supabase.storage
                    .from('portal-documents')
                    .getPublicUrl(filePath);

                // 3. Add to local list
                this.logForm.evidences.push({
                    name: file.name,
                    url: publicUrl,
                    type: file.type
                });

            } catch (e) {
                console.error(e);
                alert("Erro ao enviar evidência: " + (e.message || "Verifique o bucket."));
            } finally {
                this.uploadingLogEvidence = false;
                // Reset input
                event.target.value = '';
            }
        },

        removeLogEvidence(index) {
            this.logForm.evidences.splice(index, 1);
        },

        async saveReport(status) {
            if (!this.reportForm.title) {
                alert('Por favor, informe o Título/Instituição.');
                return;
            }

            try {
                const content = { ...this.reportForm };
                delete content.title;

                const { data, error } = await supabase.rpc('save_specialist_report', {
                    p_access_key: this.accessKey,
                    p_report_id: this.currentReport.id || null,
                    p_title: this.reportForm.title,
                    p_content: content,
                    p_status: status
                });

                if (error) throw error;

                // Refresh list
                await this.loginWithKey(); 
                this.closeReportModal();
                alert(status === 'draft' ? 'Rascunho salvo!' : 'Relatório enviado com sucesso!');

            } catch (err) {
                console.error(err);
                alert('Erro ao salvar: ' + err.message);
            }
        },

        // --- Kanban Logic (Real-time) ---
        async fetchAvailableForms() {
            // Mantido para compatibilidade, mas o seletor agora usa specialistProjects diretamente
        },

        async fetchKanbanCards() {
            if (!this.selectedEditalId) return;
            
            try {
                // selectedEditalId agora é o group_id
                const { data, error } = await supabase.rpc('get_kanban_cards', {
                    p_group_id: this.selectedEditalId
                });
                
                if (error) throw error;
                this.kanbanCards = data || [];
                
                // Setup Realtime Subscription
                this.setupKanbanSubscription();

            } catch (err) {
                console.error("Erro ao buscar kanban:", err);
                this.kanbanCards = [];
            }
        },

        setupKanbanSubscription() {
            if (this.kanbanSubscription) supabase.removeChannel(this.kanbanSubscription);
            
            this.kanbanSubscription = supabase
                .channel('kanban_changes')
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'kanban_cards', filter: `group_id=eq.${this.selectedEditalId}` },
                    (payload) => {
                        if (payload.eventType === 'INSERT') {
                            this.kanbanCards.unshift(payload.new);
                        } else if (payload.eventType === 'DELETE') {
                            this.kanbanCards = this.kanbanCards.filter(c => c.id !== payload.old.id);
                        } else if (payload.eventType === 'UPDATE') {
                            const index = this.kanbanCards.findIndex(c => c.id === payload.new.id);
                            if (index !== -1) this.kanbanCards[index] = payload.new;
                        }
                    }
                )
                .subscribe();
        },

        getKanbanItems(status) {
            return this.kanbanCards.filter(i => i.status === status);
        },

        getPriorityClass(priority) {
            switch(priority) {
                case 'high': return 'bg-red-100 text-red-700 border border-red-200';
                case 'medium': return 'bg-yellow-100 text-yellow-700 border border-yellow-200';
                case 'low': return 'bg-blue-100 text-blue-700 border border-blue-200';
                default: return 'bg-slate-100 text-slate-600 border border-slate-200';
            }
        },

        openKanbanModal(item = null, status = 'todo') {
            if (item) {
                this.kanbanForm = { ...item };
            } else {
                this.kanbanForm = {
                    id: null,
                    title: '',
                    description: '',
                    priority: 'medium',
                    assignee: this.specialist ? this.specialist.name : '',
                    status: status
                };
            }
            this.showKanbanModal = true;
        },

        async saveKanbanCard() {
            if (!this.kanbanForm.title) {
                alert("O título é obrigatório.");
                return;
            }

            try {
                let data, error;

                if (this.kanbanForm.id) {
                    // Editar
                    ({ data, error } = await supabase.rpc('edit_kanban_card', {
                        p_card_id: this.kanbanForm.id,
                        p_title: this.kanbanForm.title,
                        p_description: this.kanbanForm.description,
                        p_priority: this.kanbanForm.priority,
                        p_assignee: this.kanbanForm.assignee
                    }));
                } else {
                    // Criar
                    // Precisamos encontrar o edital_id associado ao group_id selecionado
                    const project = this.specialistProjects.find(p => p.project.group_id === this.selectedEditalId);
                    const editalId = project ? project.project.id : null; // project.id aqui é o ID da ICT/Form? Não, ver loadSpecialistProjects.
                    // loadSpecialistProjects mapeia: project: { id: item.ict.id ... }
                    // O edital_id original era o ID do form. 
                    // Vamos passar null para edital_id por enquanto se não tivermos fácil, ou tentar inferir.
                    // Na verdade, o RPC add_kanban_card pede p_edital_id.
                    // Se não for crítico, podemos passar null ou 0.
                    
                    ({ data, error } = await supabase.rpc('add_kanban_card', {
                        p_title: this.kanbanForm.title,
                        p_description: this.kanbanForm.description,
                        p_edital_id: null, // Não estamos mais filtrando por edital estrito, mas por grupo
                        p_group_id: this.selectedEditalId,
                        p_assignee: this.kanbanForm.assignee,
                        p_priority: this.kanbanForm.priority
                    }));
                    
                    // Se for novo, precisamos setar o status correto se não for 'todo'
                    if (!error && data && this.kanbanForm.status !== 'todo') {
                         await supabase.rpc('update_kanban_card_status', {
                            p_card_id: data.id,
                            p_status: this.kanbanForm.status
                        });
                        data.status = this.kanbanForm.status;
                    }
                }

                if (error) throw error;

                // Atualização otimista ou via reload
                if (this.kanbanForm.id) {
                    const index = this.kanbanCards.findIndex(c => c.id === this.kanbanForm.id);
                    if (index !== -1) this.kanbanCards[index] = data;
                } else {
                    this.kanbanCards.unshift(data);
                }

                this.showKanbanModal = false;

            } catch (err) {
                console.error("Erro ao salvar cartão:", err);
                alert("Erro ao salvar: " + err.message);
            }
        },

        async deleteKanbanItem(id) {
            if (!confirm("Excluir esta tarefa?")) return;
            
            try {
                const { error } = await supabase.rpc('delete_kanban_card', { p_card_id: id });
                if (error) throw error;
                
                this.kanbanCards = this.kanbanCards.filter(c => c.id !== id);
            } catch (err) {
                console.error("Erro ao excluir:", err);
            }
        },

        onDragStart(evt, item) {
            evt.dataTransfer.dropEffect = 'move';
            evt.dataTransfer.effectAllowed = 'move';
            evt.dataTransfer.setData('itemId', item.id);
        },

        async onDrop(evt, newStatus) {
            const itemId = parseInt(evt.dataTransfer.getData('itemId'));
            const item = this.kanbanCards.find(i => i.id === itemId);
            
            if (item && item.status !== newStatus) {
                const oldStatus = item.status;
                item.status = newStatus; // Optimistic update
                
                try {
                    const { error } = await supabase.rpc('update_kanban_card_status', {
                        p_card_id: itemId,
                        p_status: newStatus
                    });
                    
                    if (error) {
                        item.status = oldStatus; // Revert
                        throw error;
                    }
                } catch (err) {
                    console.error("Erro ao mover cartão:", err);
                    alert("Erro ao atualizar status.");
                }
            }
        }
    },
    mounted() {
        // Check for Specialist Session
        const savedSpecKey = localStorage.getItem('specialist_key');
        if (savedSpecKey) {
            this.accessKey = savedSpecKey;
            this.loginMode = 'specialist';
            this.loginWithKey();
            return;
        }

        // Check for Institution Session
        const savedKey = localStorage.getItem('assistec_portal_key');
        const savedExp = localStorage.getItem('assistec_portal_exp');

        if (savedKey && savedExp) {
            if (Date.now() < parseInt(savedExp)) {
                this.accessKey = savedKey;
                this.loginWithKey();
            } else {
                localStorage.removeItem('assistec_portal_key');
                localStorage.removeItem('assistec_portal_exp');
            }
        }
    }
}).mount('#portalApp'); // Certifique-se que o ID no portal.html é #portalApp
