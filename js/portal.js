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
            uploading: false
        }
    },
    watch: {
        calendarYear() { this.processCalendar(); },
        eventList: {
            handler() { this.processCalendar(); },
            deep: true
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
            // Auto-fill title with category if it's empty or matches a previous category
            // For simplicity, we just set it to the category name if the user hasn't typed a custom title
            // OR we can just append the category.
            // Let's just set it to the category name for now as a default.
            if (!this.eventForm.title || this.categoryColors[this.eventForm.title] || Object.keys(this.categoryColors).includes(this.eventForm.title)) {
                 this.eventForm.title = this.eventForm.category;
            }
            // Better approach: Just set it. The user can edit it.
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
            
            if (!this.eventForm.title) {
                this.eventForm.title = this.eventForm.category;
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
            if (member) {
                this.teamForm = { ...member };
            } else {
                this.teamForm = { name: '', role: 'Coordenador', email: '', phone: '' };
            }
            this.showTeamModal = true;
        },
        async saveTeamMember() {
            if (!this.teamForm.name) {
                alert("Nome é obrigatório."); return;
            }
            
            const action = this.teamForm.id ? 'update' : 'create';
            
            try {
                const { data, error } = await supabase.rpc('manage_team_member', {
                    p_access_key: this.accessKey.trim(),
                    p_member_data: this.teamForm,
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
    }
}).mount('#portalApp'); // Certifique-se que o ID no portal.html é #portalApp
