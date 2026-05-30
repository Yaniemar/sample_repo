// --- DATA LAYER CONFIG & BACKEND PROBE ---
const API_BASE = "/api";
const ENDPOINTS = {
    summary: `${API_BASE}/tasks/summary/`,
    today: `${API_BASE}/tasks/today/`,
    upcoming: `${API_BASE}/tasks/upcoming/`,
    tasks: `${API_BASE}/tasks/`,
    voice: `${API_BASE}/tasks/from-voice/`,
    login: `${API_BASE}/accounts/login/`,
    register: `${API_BASE}/accounts/register/`
};

function getCSRFToken() {

    const fromCookie = document.cookie.split(';').find(c => c.trim().startsWith('csrftoken='));
    if (fromCookie) {
        return fromCookie.trim().split('=')[1];
    }

    const fromMeta = document.querySelector('meta[name="csrf-token"]');
    if (fromMeta) {
        return fromMeta.getAttribute('content');
    }

    const fromInput = document.querySelector('input[name="csrfmiddlewaretoken"]');
    if (fromInput) {
        return fromInput.value;
    }

    return '';
}

async function apiFetch(url, options = {}) {
    const csrfToken = getCSRFToken();
    if (!csrfToken) {
        console.warn('Missing CSRF token for apiFetch request to', url);
    }

    const defaults = {
        credentials: 'include',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': csrfToken

        }
    };

    return fetch(url, {
        ...defaults,
        ...options,
        headers: {
            ...defaults.headers,
            ...options.headers
        }
    });
}

let isOnline = false;
let currentUser = null;
let activeAuthMode = 'login';

// Dynamic Filter State
let currentFilter = 'all';

// May 2026 default timeframe constraints to perfectly match images
let selectedCalendarDate = new Date(2026, 4, 17); // May 17, 2026
let calendarYear = 2026;
let calendarMonth = 4; // May (0-indexed)

// Local Storage fallback system - starting with cleanly emptied arrays
let localTasks = [];
let localNotifications = [];
let extraEmails = [];

// Dynamic presets settings
let selectedLang = "English(US)";
let selectedRegion = "Philippines (English)";
let activeAvatarBg = "#E2E8F0";
let activeAvatarImage = "";

// Modal specific trackers
let taskToDeleteId = null;
let renderedTaskCache = {};
let calendarTasksCache = [];

const languagesData = [
    { name: "English(US)", sub: "" },
    { name: "Af-Soomaali", sub: "Somali" },
    { name: "Afrikaans", sub: "Afrikaans" },
    { name: "Bahasa Indonesia", sub: "Indonesian" },
    { name: "Deutsch", sub: "German" },
    { name: "Español", sub: "Spanish" },
    { name: "Français", sub: "French" }
];

const regionsData = [
    { name: "Philippines (English)", sub: "3/14/26, 18:07" },
    { name: "Albania (Albanian)", sub: "3/14/26, 6:09 PM" },
    { name: "Algeria (Arabic)", sub: "3/14/26, 5:08" },
    { name: "Algeria (French)", sub: "3/14/26, 5:08" },
    { name: "United States (English)", sub: "3/14/26, 5:08 AM" },
    { name: "Japan (Japanese)", sub: "3/14/26, 19:08" }
];

// Cache elements
const networkBanner = document.getElementById('networkBanner');
const networkText = document.getElementById('networkText');
const mainHeader = document.getElementById('mainHeader');
const authPageWrapper = document.getElementById('auth-page-wrapper');
const appContentWrapper = document.getElementById('app-content-wrapper');
const dashboardPanel = document.getElementById('dashboard-panel');
const calendarPanel = document.getElementById('calendar-panel');

const bellBtn = document.getElementById('bellBtn');
const profileBtn = document.getElementById('profileBtn');
const notifDropdown = document.getElementById('notifDropdown');
const profileDropdown = document.getElementById('profileDropdown');

const taskModal = document.getElementById('taskModal');
const openModalBtn = document.getElementById('openModalBtn');
const closeModalBtn = document.getElementById('closeModalBtn');
const taskForm = document.getElementById('taskForm');

const micBtn = document.getElementById('micBtn');
const voiceToast = document.getElementById('voiceToast');
const systemAlert = document.getElementById('systemAlert');

const authError = document.getElementById('authError');


// Application Startup Initialization
document.addEventListener('DOMContentLoaded', async () => {
    initializeDatabase();
    await checkBackendHandshake();
    checkUserSession();
    
    // Set default date input value to today
    document.getElementById('taskDate').value = getTodayDateString();
    document.getElementById('taskTime').value = "09:00";
    
    initVoiceRecognition();
    initDeleteConfirmationListener();
});

// --- AUTHENTICATION & SESSION HANDLING ---
function checkUserSession() {
    const savedUser = localStorage.getItem('vast_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        applySessionLogin(currentUser.username);
    } else {
        applySessionLogout();
    }
}

// Toggle Auth layout switch between sign-in and registration models
function toggleAuthMode() {

    clearAuthError();

    const fullNameGroup = document.getElementById('fullNameGroup');
    const authSubmitBtn = document.getElementById('authSubmitBtn');
    const authToggleText = document.getElementById('authToggleText');
    const toggleAuthModeLink = document.getElementById('toggleAuthMode');
    
    if (activeAuthMode === 'login') {
        activeAuthMode = 'signup';
        fullNameGroup.style.display = 'block';
        authSubmitBtn.textContent = 'Register Account';
        authToggleText.textContent = 'Already have an account?';
        toggleAuthModeLink.textContent = 'Log In Here';
    } else {
        activeAuthMode = 'login';
        fullNameGroup.style.display = 'none';
        authSubmitBtn.textContent = 'Confirm Log In';
        authToggleText.textContent = "Don't have an account yet?";
        toggleAuthModeLink.textContent = 'Create an Account';
    }
}

// Handle confirmation of log in or user registration submitting form
async function handleAuthSubmit(event) {
    event.preventDefault();

    clearAuthError();


    const usernameInput = document.getElementById('authUsername').value.trim();
    const passwordInput = document.getElementById('authPassword').value;
    const fallbackName = usernameInput.charAt(0).toUpperCase() + usernameInput.slice(1);
    const fullNameInput = document.getElementById('authFullName').value.trim() || fallbackName;


    if (!usernameInput) {
        setAuthError('Please enter your username or email.');
        return;
    }
    if (!passwordInput) {
        setAuthError('Please enter your password.');
        return;
    }
    if (activeAuthMode === 'signup' && !fullNameInput) {
        setAuthError('Please enter your full name for registration.');
        return;
    }

    try {
        const response = await apiFetch(activeAuthMode === 'signup' ? ENDPOINTS.register : ENDPOINTS.login, {
            method: 'POST',

            body: JSON.stringify({
                username: usernameInput,
                password: passwordInput,
                name: fullNameInput,
                email: usernameInput.includes('@') ? usernameInput : ''
            })
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));

            const errorMessage = formatApiError(errorBody) || 'Authentication failed. Please check your details.';
            setAuthError(errorMessage);
            showSystemToast(errorMessage);

            return;
        }

        const user = await response.json();
        currentUser = {
            username: user.username,
            name: user.name || fallbackName,
            email: user.email || (usernameInput.includes('@') ? usernameInput : ''),
            avatarBg: "#338A85",
            avatarImg: ""
        };
        isOnline = true;
    } catch (err) {
        console.error("Backend auth unavailable, using local session fallback:", err);
        currentUser = {
            username: usernameInput,
            name: activeAuthMode === 'signup' ? fullNameInput : fallbackName,
            email: usernameInput.includes('@') ? usernameInput : '',
            avatarBg: "#338A85",
            avatarImg: ""
        };
    }

    localStorage.setItem('vast_user', JSON.stringify(currentUser));
    
    // Vocal feedback validation speech synthesizer
    triggerVocalResponse(`Welcome to VAST, ${currentUser.name}! Speak your tasks or schedule manually.`);

    applySessionLogin(currentUser.username);
}

function applySessionLogin(username) {
    // Un-render Auth page completely and reveal Dashboard Wrapper
    authPageWrapper.style.display = 'none';
    appContentWrapper.style.display = 'flex';
    
    // Apply profile updates
    updateProfileUI();

    navigateTo('dashboard');
    window.scrollTo(0, 0); // Reset page layout scroll position completely
}

function updateProfileUI() {
    if (!currentUser) return;
    
    const initials = currentUser.name.charAt(0).toUpperCase();
    
    // Update Text Nodes
    document.getElementById('profileName').textContent = currentUser.name;
    document.getElementById('avatarLetter').textContent = initials;
    document.getElementById('headerProfileAvatar').textContent = initials;
    document.getElementById('settingsSidebarAvatarLetter').textContent = initials;

    // Apply Presets (Image vs Color Backgrounds)
    const elements = [
        document.getElementById('avatarLetter'),
        document.getElementById('headerProfileAvatar'),
        document.getElementById('settingsSidebarAvatarLetter'),
        document.getElementById('avatarCirclePreview')
    ];

    elements.forEach(el => {
        if (el) {
            if (currentUser.avatarImg) {
                el.style.backgroundImage = `url(${currentUser.avatarImg})`;
                el.textContent = "";
            } else {
                el.style.backgroundImage = "none";
                el.textContent = initials;
                el.style.backgroundColor = currentUser.avatarBg || "#338A85";
                el.style.color = "white";
            }
        }
    });
}

function handleLogout() {
    localStorage.removeItem('vast_user');
    currentUser = null;
    applySessionLogout();
    closeAllHeaderPopups();
}


function setAuthError(message) {
    if (authError) {
        authError.textContent = message;
    }
}

function clearAuthError() {
    if (authError) {
        authError.textContent = '';
    }
}


function applySessionLogout() {
    // Hide dashboard framework completely and reveal clean Fullscreen Centered Auth page
    appContentWrapper.style.display = 'none';
    authPageWrapper.style.display = 'flex';
    
    dashboardPanel.classList.remove('active');
    calendarPanel.classList.remove('active');
    document.getElementById('settings-panel').classList.remove('active');
    window.scrollTo(0, 0); // Reset page layout scroll position completely
}

// --- LOCAL STORAGE DATABASE INITS (Empty by default) ---
function initializeDatabase() {
    if (!localStorage.getItem('vast_tasks')) {
        localStorage.setItem('vast_tasks', JSON.stringify([]));
    }
    if (!localStorage.getItem('vast_notifs')) {
        localStorage.setItem('vast_notifs', JSON.stringify([]));
    }
    if (!localStorage.getItem('vast_emails')) {
        localStorage.setItem('vast_emails', JSON.stringify([]));
    }
    localTasks = JSON.parse(localStorage.getItem('vast_tasks'));
    localNotifications = JSON.parse(localStorage.getItem('vast_notifs'));
    extraEmails = JSON.parse(localStorage.getItem('vast_emails'));
}

// --- DUAL-MODE HANDSHAKE MONITOR ---
async function checkBackendHandshake() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s quick probe
        

        const response = await apiFetch(ENDPOINTS.summary, { signal: controller.signal });

        clearTimeout(timeoutId);
        
        if (response.ok) {
            isOnline = true;
            networkBanner.classList.remove('offline');
            networkText.textContent = "Live Connected to V.A.S.T. Django Cloud Backend DB";
        } else {
            throw new Error("API responded with an error status.");
        }
    } catch (err) {
        isOnline = false;
        networkBanner.classList.add('offline');
        networkText.textContent = "Offline Mode Active (Using Premium Local Handshake Store)";
    }
}

// --- DASHBOARD DISPLAY SYSTEM ---
async function fetchDashboardData() {
    // Live backend versus Offline local execution switch
    if (isOnline) {
        try {
            const [summaryRes, todayRes, upcomingRes, allTasksRes] = await Promise.all([

                apiFetch(ENDPOINTS.summary),
                apiFetch(ENDPOINTS.today),
                apiFetch(ENDPOINTS.upcoming),
                apiFetch(ENDPOINTS.tasks)

            ]);

            if (summaryRes.ok) {
                const summary = await summaryRes.json();
                updateMetricsSummary(summary);
            }
            
            let todayTasks = [];
            let upcomingTasks = [];
            if (todayRes.ok) todayTasks = await todayRes.json();
            if (upcomingRes.ok) upcomingTasks = await upcomingRes.json();
            if (allTasksRes.ok) {
                calendarTasksCache = await allTasksRes.json();
                calendarTasksCache.forEach(task => {
                    renderedTaskCache[task.id] = task;
                });
            }

            // Apply unified filtering & render
            filterAndRenderDashboard(todayTasks, upcomingTasks);
        } catch (err) {
            console.error("Backend pipeline interrupted, returning to Offline Handshake execution...", err);
            isOnline = false;
            fetchDashboardDataOffline();
        }
    } else {
        fetchDashboardDataOffline();
    }
}

function fetchDashboardDataOffline() {
    // Calculate Offline Summary Statistics
    const todayStr = getTodayDateString();

    const pending = localTasks.filter(t => t.status !== 'completed').length;
    const completed = localTasks.filter(t => t.status === 'completed').length;
    const priority = localTasks.filter(t => t.priority === 'high' && t.status !== 'completed').length;
    
    // Check overdue task constraints
    const overdue = localTasks.filter(t => {
        return t.status !== 'completed' && t.date < todayStr;
    }).length;

    updateMetricsSummary({ pending, completed, priority, overdue });

    // Segment database normally based on May 17, 2026 timeline constraints
    const todayTasks = localTasks.filter(t => t.date === todayStr);
    const upcomingTasks = localTasks.filter(t => t.date > todayStr);

    filterAndRenderDashboard(todayTasks, upcomingTasks);
}

// --- UNIFIED FILTER RENDERING ENGINE ---
function filterAndRenderDashboard(allTodayTasks, allUpcomingTasks) {

    const todayStr = getTodayDateString();
    const sourceList = isOnline ? calendarTasksCache : localTasks;

    const todayTasks = sourceList.filter(t => t.date === todayStr);
    const upcomingTasks = sourceList.filter(t => t.date > todayStr);
    const overdueTasks = sourceList.filter(t => t.date < todayStr);

    let filteredToday = [...todayTasks];
    let filteredUpcoming = [...upcomingTasks];
    let todayLabel = "Today's Tasks";
    let upcomingLabel = "Upcoming Tasks";

    if (currentFilter === 'overdue') {
        filteredToday = overdueTasks.filter(t => t.status !== 'completed');
        filteredUpcoming = overdueTasks.filter(t => t.status === 'completed');

        
        todayLabel = "Overdue Tasks (Incomplete)";
        upcomingLabel = "Overdue Tasks (Completed)";
    } else if (currentFilter !== 'all') {
        if (currentFilter === 'pending') {

            filteredToday = [...todayTasks, ...overdueTasks].filter(t => t.status !== 'completed');
            filteredUpcoming = upcomingTasks.filter(t => t.status !== 'completed');
        } else if (currentFilter === 'completed') {
            filteredToday = [...todayTasks, ...overdueTasks].filter(t => t.status === 'completed');
            filteredUpcoming = upcomingTasks.filter(t => t.status === 'completed');
        } else if (currentFilter === 'high') {
            filteredToday = [...todayTasks, ...overdueTasks].filter(t => t.priority === 'high');
            filteredUpcoming = upcomingTasks.filter(t => t.priority === 'high');

        }
    }

    // Update column labels dynamically
    document.getElementById('todayHeaderLabel').textContent = todayLabel;
    document.getElementById('upcomingHeaderLabel').textContent = upcomingLabel;

    renderTaskList(filteredToday, 'today-tasks-list', true);
    renderTaskList(filteredUpcoming, 'upcoming-tasks-list', false);
}

// --- DASHBOARD CARD METRICS UPDATE ACTION ---
function updateMetricsSummary(data) {
    document.getElementById('count-pending').textContent = data.pending ?? data.in_progress ?? 0;
    document.getElementById('count-completed').textContent = data.completed ?? 0;
    document.getElementById('count-priority').textContent = data.priority ?? 0;
    document.getElementById('count-overdue').textContent = data.overdue ?? 0;
}

function filterDashboardTasks(filterType) {
    if (currentFilter === filterType) {
        currentFilter = 'all'; // Toggle off
        showSystemToast("Clearing filters. Displaying all tasks.");
    } else {
        currentFilter = filterType;
        showSystemToast(`Filtering by: ${filterType.toUpperCase()}`);
    }

    const activeFilters = ['pending', 'completed', 'high', 'overdue'];
    const labels = ['pendings', 'completed', 'priority', 'overdue'];
    
    labels.forEach((lbl, index) => {
        const card = document.querySelector(`.stat-card.${lbl}`);
        if (activeFilters[index] === currentFilter) {
            card.style.transform = 'scale(1.04)';
            card.style.border = '2px solid var(--header-bg)';
        } else {
            card.style.transform = '';
            card.style.border = '';
        }
    });

    // Update filter sub-text dynamically
    const subLabel = currentFilter !== 'all' ? `(${currentFilter.toUpperCase()})` : '';
    document.getElementById('filterTextToday').textContent = subLabel;
    document.getElementById('filterTextUpcoming').textContent = subLabel;

    fetchDashboardData();
}

function renderTaskList(tasks, targetContainerId, isToday) {
    const container = document.getElementById(targetContainerId);
    container.innerHTML = '';

    if (tasks.length === 0) {
        container.innerHTML = `<div class="no-tasks">No tasks found</div>`;
        return;
    }

    // Sort tasks by time chronologically
    tasks.sort((a, b) => a.time.localeCompare(b.time));

    tasks.forEach(task => {
        renderedTaskCache[task.id] = task;
        const taskItem = document.createElement('div');
        taskItem.className = `task-item ${task.status === 'completed' ? 'is-completed' : ''}`;
        
        const timeString = formatTime(task.time);
        const displayMetadata = isToday ? timeString : `${formatShortDate(task.date)} • ${timeString}`;

        taskItem.innerHTML = `
            <div class="task-left">
                <input type="checkbox" class="task-checkbox" ${task.status === 'completed' ? 'checked' : ''} onchange="toggleTaskStatus(${task.id}, '${task.status}')">
                <span class="task-title">${escapeHTML(task.title)}</span>
            </div>
            <div class="task-right">
                <span class="task-time">${displayMetadata}</span>
                <div class="priority-dot ${task.priority}" title="${task.priority} priority"></div>
                <button class="edit-task-btn" title="Edit task" onclick="openEditTaskModal(event, ${task.id})">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="delete-task-btn" title="Delete task" onclick="deleteTask(${task.id})">&times;</button>
            </div>
        `;
        container.appendChild(taskItem);
    });
}

// --- TASKS CRUCIAL OPERATION ENGINE ---
async function toggleTaskStatus(taskId, currentStatus) {
    const nextStatus = currentStatus === 'completed' ? 'pending' : 'completed';

    try {

        const response = await apiFetch(`${ENDPOINTS.tasks}${taskId}/`, {
            method: 'PATCH',

            body: JSON.stringify({ status: nextStatus })
        });
        if (response.ok) {
            isOnline = true;
            fetchDashboardData();
            showSystemToast(nextStatus === 'completed' ? "Task marked complete." : "Task marked pending.");
            return;
        }
        const errorBody = await response.json().catch(() => ({}));
        showSystemToast(`Update failed: ${formatApiError(errorBody)}`);
    } catch (err) {
        console.error("Online patch mutation failure, transitioning offline:", err);
    }

    // Offline Handshake Fallback execution
    const taskIndex = localTasks.findIndex(t => t.id === taskId);
    if (taskIndex !== -1) {
        localTasks[taskIndex].status = nextStatus;
        saveLocalDatabase();
        
        if (nextStatus === 'completed') {
            showSystemToast(`Completed: ${localTasks[taskIndex].title}!`);
            addSystemNotification("Congratulations!", `You've completed ${localTasks[taskIndex].title}.`, "Just now", "complete");
        }
        
        fetchDashboardData();
        if (calendarPanel.classList.contains('active')) {
            renderCalendarMatrix();
            inspectCalendarSelectedDayTasks();
        }
    }
}

// Trigger custom styled delete confirmation modal
function deleteTask(taskId) {
    taskToDeleteId = taskId;
    const modal = document.getElementById('deleteConfirmModal');
    modal.classList.add('active');
}

function closeDeleteConfirmModal() {
    document.getElementById('deleteConfirmModal').classList.remove('active');
    taskToDeleteId = null;
}

function initDeleteConfirmationListener() {
    document.getElementById('confirmDeleteBtn').addEventListener('click', async () => {
        if (!taskToDeleteId) return;
        const taskId = taskToDeleteId;
        closeDeleteConfirmModal();

        try {
            const response = await fetch(`${ENDPOINTS.tasks}${taskId}/`, {
                method: 'DELETE'
            });
            if (response.ok) {
                isOnline = true;
                fetchDashboardData();
                showSystemToast("Task deleted successfully.");
                return;
            }
        } catch (err) {
            console.error("Online delete process failure:", err);
        }

        // Offline Local Database fallback delete
        const taskIndex = localTasks.findIndex(t => t.id === taskId);
        if (taskIndex !== -1) {
            const deletedTitle = localTasks[taskIndex].title;
            localTasks.splice(taskIndex, 1);
            saveLocalDatabase();
            showSystemToast(`Deleted task: ${deletedTitle}`);
            
            fetchDashboardData();
            if (calendarPanel.classList.contains('active')) {
                renderCalendarMatrix();
                inspectCalendarSelectedDayTasks();
            }
        }
    });
}

// --- TASK EDITING & RETRIEVAL WORKFLOW ---
async function openEditTaskModal(event, taskId) {
    if (event) event.stopPropagation();

    let task = renderedTaskCache[taskId] || calendarTasksCache.find(t => t.id === taskId) || localTasks.find(t => t.id === taskId);

    if (!task) {
        try {
            const response = await fetch(`${ENDPOINTS.tasks}${taskId}/`);
            if (response.ok) {
                task = await response.json();
                renderedTaskCache[task.id] = task;
            }
        } catch (err) {
            console.error("Failed to fetch task for editing:", err);
        }
    }

    if (!task) {
        showSystemToast("Could not load this task for editing.");
        return;
    }

    document.getElementById('editTaskId').value = task.id;
    document.getElementById('editTaskTitle').value = task.title;
    document.getElementById('editTaskDate').value = task.date;
    document.getElementById('editTaskTime').value = normalizeTimeForInput(task.time);
    document.getElementById('editTaskPriority').value = task.priority;
    document.getElementById('editTaskStatus').value = task.status || 'pending';

    document.getElementById('editTaskModal').classList.add('active');
}

function closeEditTaskModal() {
    document.getElementById('editTaskModal').classList.remove('active');
}

async function handleEditTaskSubmit(event) {
    event.preventDefault();
    const taskId = parseInt(document.getElementById('editTaskId').value, 10);
    const title = document.getElementById('editTaskTitle').value.trim();
    const date = document.getElementById('editTaskDate').value;
    const time = document.getElementById('editTaskTime').value;
    const priority = document.getElementById('editTaskPriority').value;
    const status = document.getElementById('editTaskStatus').value;

    const payload = {
        title,
        date,
        time,
        priority,
        status
    };

    try {

        const response = await apiFetch(`${ENDPOINTS.tasks}${taskId}/`, {
            method: 'PATCH',

            body: JSON.stringify(payload)
        });
        if (response.ok) {
            isOnline = true;
            closeEditTaskModal();
            fetchDashboardData();
            showSystemToast("Task saved successfully!");
            return;
        }
        const errorBody = await response.json().catch(() => ({}));
        showSystemToast(`Edit failed: ${formatApiError(errorBody)}`);
    } catch (err) {
        console.error("Online task edit mutation failure:", err);
    }

    // Offline Local Database fallback update
    const taskIndex = localTasks.findIndex(t => t.id === taskId);
    if (taskIndex !== -1) {
        localTasks[taskIndex] = {
            ...localTasks[taskIndex],
            ...payload
        };
        saveLocalDatabase();
        closeEditTaskModal();
        showSystemToast(`Updated task: ${title}`);
        
        fetchDashboardData();
        if (calendarPanel.classList.contains('active')) {
            renderCalendarMatrix();
            inspectCalendarSelectedDayTasks();
        }
    }
}

// --- MANUAL SUBMIT ENGINE ---
async function handleAddTaskSubmit(event) {
    event.preventDefault();
    const title = document.getElementById('taskTitle').value.trim();
    const date = document.getElementById('taskDate').value;
    const time = document.getElementById('taskTime').value;
    const priority = document.getElementById('taskPriority').value;

    const payload = {
        title,
        date,
        time,
        priority,
        status: "pending"
    };

    try {

        const response = await apiFetch(ENDPOINTS.tasks, {
            method: 'POST',

            body: JSON.stringify(payload)
        });
        if (response.ok) {
            isOnline = true;
            finishTaskCreation();
            return;
        }
        const errorBody = await response.json().catch(() => ({}));
        showSystemToast(`Create failed: ${formatApiError(errorBody)}`);
    } catch (err) {
        console.error("Online task creation fallback executed:", err);
    }

    // Offline payload mock insertion
    const newTask = {
        id: Date.now(),
        ...payload
    };
    localTasks.push(newTask);
    saveLocalDatabase();
    finishTaskCreation();
}

function finishTaskCreation() {
    taskForm.reset();
    // Default restore
    document.getElementById('taskDate').value = getTodayDateString();
    document.getElementById('taskTime').value = "09:00";
    
    toggleModal(false);
    fetchDashboardData();
    
    if (calendarPanel.classList.contains('active')) {
        renderCalendarMatrix();
        inspectCalendarSelectedDayTasks();
    }

    showSystemToast("Task successfully created!");
    triggerVocalResponse("Task successfully created.");
}

function saveLocalDatabase() {
    localStorage.setItem('vast_tasks', JSON.stringify(localTasks));
    localStorage.setItem('vast_notifs', JSON.stringify(localNotifications));
    localStorage.setItem('vast_emails', JSON.stringify(extraEmails));
}

// --- CALENDAR GRID IMPLEMENTATION ---
function renderCalendarMatrix() {
    const grid = document.getElementById('calendarGrid');
    grid.innerHTML = '';

    // Render Weekday Labels Sun-Sat
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    weekdays.forEach(day => {
        const dayHeader = document.createElement('div');
        dayHeader.className = 'weekday-label';
        dayHeader.textContent = day;
        grid.appendChild(dayHeader);
    });

    // May 2026 starts on Friday (start day offset = 5)
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const startDayOffset = new Date(calendarYear, calendarMonth, 1).getDay();

    // Populate empty calendar spaces
    for (let i = 0; i < startDayOffset; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'cal-day empty-day';
        grid.appendChild(emptyCell);
    }

    // Draw month days
    for (let day = 1; day <= daysInMonth; day++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'cal-day';
        dayCell.textContent = day;

        // Formulate verification date context
        const yearStr = calendarYear;
        const monthStr = String(calendarMonth + 1).padStart(2, '0');
        const dayStr = String(day).padStart(2, '0');
        const dateCompare = `${yearStr}-${monthStr}-${dayStr}`;

        // Mark date cell if active selected
        if (selectedCalendarDate.getDate() === day && 
            selectedCalendarDate.getMonth() === calendarMonth && 
            selectedCalendarDate.getFullYear() === calendarYear) {
            dayCell.classList.add('active-day');
        }

        // CHECK DYNAMIC TASK DOT: Circles below ONLY appear if tasks are scheduled for that specific day
        const calendarSourceTasks = isOnline ? calendarTasksCache : localTasks;
        const hasTasks = calendarSourceTasks.some(t => t.date === dateCompare);
        if (hasTasks) {
            dayCell.classList.add('has-tasks');
        }

        dayCell.addEventListener('click', () => {
            selectCalendarDate(day);
        });

        grid.appendChild(dayCell);
    }

    // Dynamic header label
    const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];
    document.getElementById('calendarMonthLabel').textContent = `${monthNames[calendarMonth]} ${calendarYear}`;
}

function changeMonth(dir) {
    calendarMonth += dir;
    if (calendarMonth < 0) {
        calendarMonth = 11;
        calendarYear--;
    } else if (calendarMonth > 11) {
        calendarMonth = 0;
        calendarYear++;
    }
    
    // Re-anchor active day boundary selection safety checks
    selectedCalendarDate = new Date(calendarYear, calendarMonth, 1);
    renderCalendarMatrix();
    inspectCalendarSelectedDayTasks();
}

function selectCalendarDate(day) {
    selectedCalendarDate = new Date(calendarYear, calendarMonth, day);
    renderCalendarMatrix();
    inspectCalendarSelectedDayTasks();
}

function inspectCalendarSelectedDayTasks() {
    const listContainer = document.getElementById('calendarDayTaskList');
    const dateLabel = document.getElementById('focusedDateLabel');

    const weekdayOptions = { weekday: 'short', month: 'short', day: 'numeric' };
    dateLabel.textContent = selectedCalendarDate.toLocaleDateString('en-US', weekdayOptions);

    const yearStr = selectedCalendarDate.getFullYear();
    const monthStr = String(selectedCalendarDate.getMonth() + 1).padStart(2, '0');
    const dayStr = String(selectedCalendarDate.getDate()).padStart(2, '0');
    const formattedDate = `${yearStr}-${monthStr}-${dayStr}`;

    // Filtering matches corresponding exactly to current date
    const calendarSourceTasks = isOnline ? calendarTasksCache : localTasks;
    const dayTasks = calendarSourceTasks.filter(t => t.date === formattedDate);

    listContainer.innerHTML = '';

    if (dayTasks.length === 0) {
        listContainer.innerHTML = `<div class="no-tasks">No tasks scheduled for this day</div>`;
        return;
    }

    dayTasks.sort((a, b) => a.time.localeCompare(b.time));

    dayTasks.forEach(task => {
        renderedTaskCache[task.id] = task;
        const taskCard = document.createElement('div');
        taskCard.className = `task-item ${task.status === 'completed' ? 'is-completed' : ''}`;
        
        taskCard.innerHTML = `
            <div class="task-left">
                <input type="checkbox" class="task-checkbox" ${task.status === 'completed' ? 'checked' : ''} onchange="toggleTaskStatus(${task.id}, '${task.status}')">
                <span class="task-title">${escapeHTML(task.title)}</span>
            </div>
            <div class="task-right">
                <span class="task-time">${formatTime(task.time)}</span>
                <div class="priority-dot ${task.priority}"></div>
                <button class="edit-task-btn" title="Edit task" onclick="openEditTaskModal(event, ${task.id})">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                </button>
                <button class="delete-task-btn" title="Delete task" onclick="deleteTask(${task.id})">&times;</button>
            </div>
        `;
        listContainer.appendChild(taskCard);
    });
}

// --- ACCOUNT SETTINGS COMPONENT POPULATION ---
function populateSettingsInputs() {
    if (!currentUser) return;

    // Split dynamic Full Name into First and Last Names automatically
    const nameParts = currentUser.name.trim().split(/\s+/);
    const firstName = nameParts[0] || '';
    const lastName = nameParts.slice(1).join(' ') || '';

    document.getElementById('settingsFirstName').value = firstName;
    document.getElementById('settingsLastName').value = lastName;

    // Pre-populate sidebar branding
    document.getElementById('settingsSidebarName').innerHTML = `${currentUser.name} <span style="font-size: 11px; cursor: pointer; color: var(--accent-teal);">✎</span>`;

    // Format proper fallback email dynamically
    const sanitizeUser = currentUser.username.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
    document.getElementById('settingsEmail').value = `${sanitizeUser}@gmail.com`;

    // Render Extra Connected Emails dynamically if present
    renderExtraEmails();

    // Set active settings language/region badges
    document.getElementById('settingsActiveLangDesc').textContent = selectedLang;
    document.getElementById('settingsActiveRegionDesc').textContent = selectedRegion;

    // Update photo previews
    const box = document.getElementById('settingsPicBox');
    if (currentUser.avatarImg) {
        box.style.backgroundImage = `url(${currentUser.avatarImg})`;
        box.innerHTML = '';
    } else {
        box.style.backgroundImage = 'none';
        box.style.backgroundColor = currentUser.avatarBg || '#F8F9FA';
        box.innerHTML = `<span style="font-size:32px; font-weight:700; color:white;">${currentUser.name.charAt(0).toUpperCase()}</span>`;
    }
}

function switchSettingsTab(tabName) {
    // Deactivate all panes
    document.querySelectorAll('.settings-content-pane').forEach(pane => pane.classList.remove('active'));
    document.querySelectorAll('.settings-nav-item').forEach(item => item.classList.remove('active'));

    // Activate chosen pane and sidebar item
    document.getElementById(`settings-pane-${tabName}`).classList.add('active');
    
    // Match click selectors
    const targetNavIndex = tabName === 'profile' ? 0 : tabName === 'password' ? 1 : 2;
    document.querySelectorAll('.settings-nav-item')[targetNavIndex].classList.add('active');
}

function savePersonalDetails() {
    const first = document.getElementById('settingsFirstName').value.trim();
    const last = document.getElementById('settingsLastName').value.trim();

    if (!first) {
        showSystemToast("Name context requires at least a First Name.");
        return;
    }

    currentUser.name = `${first} ${last}`.trim();
    localStorage.setItem('vast_user', JSON.stringify(currentUser));

    // Apply dynamic changes globally across UI
    updateProfileUI();
    populateSettingsInputs();
    
    showSystemToast("Personal profile details updated successfully!");
    triggerVocalResponse("Profile saved successfully.");
}

function saveNewPassword() {
    const currentPass = document.getElementById('settingsCurrentPassword').value;
    const newPass = document.getElementById('settingsNewPassword').value;
    const confirmPass = document.getElementById('settingsRetypePassword').value;

    if (!currentPass || !newPass) {
        showSystemToast("All password form groups are required.");
        return;
    }

    if (newPass !== confirmPass) {
        showSystemToast("Passwords mismatch! Retype confirmation.");
        return;
    }

    showSystemToast("Credentials updated securely.");
    document.getElementById('settingsCurrentPassword').value = '';
    document.getElementById('settingsNewPassword').value = '';
    document.getElementById('settingsRetypePassword').value = '';
}

// --- POPUP MODAL CONTROL ENGINE (NEW Figma Assets) ---

// 1. Upload Photo Modal (`Upload photo.png`)
function openUploadPhotoModal() {
    const modal = document.getElementById('uploadPhotoModal');
    modal.classList.add('active');
    
    // Sync active preview color
    activeAvatarBg = currentUser.avatarBg || "#E2E8F0";
    activeAvatarImage = currentUser.avatarImg || "";
    
    updateAvatarPreviewInModal();
    
    // Select active preset border
    document.querySelectorAll('.avatar-preset-btn').forEach(btn => {
        const btnColor = rgb2hex(btn.style.backgroundColor).toUpperCase();
        const activeHex = activeAvatarBg.toUpperCase();
        if (btnColor === activeHex) {
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
        }
    });
}

function closeUploadPhotoModal() {
    document.getElementById('uploadPhotoModal').classList.remove('active');
}

function selectAvatarPreset(colorHex, imgBase64 = "") {
    activeAvatarBg = colorHex;
    activeAvatarImage = imgBase64;
    
    // Highlight selected
    document.querySelectorAll('.avatar-preset-btn').forEach(btn => {
        const btnColor = rgb2hex(btn.style.backgroundColor).toUpperCase();
        if (btnColor === colorHex.toUpperCase()) {
            btn.classList.add('selected');
        } else {
            btn.classList.remove('selected');
        }
    });
    
    updateAvatarPreviewInModal();
}

function handlePhotoFileSelected(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        activeAvatarImage = e.target.result;
        activeAvatarBg = ""; // Reset background color to prefer image
        updateAvatarPreviewInModal();
    };
    reader.readAsDataURL(file);
}

function updateAvatarPreviewInModal() {
    const preview = document.getElementById('avatarCirclePreview');
    const initials = currentUser ? currentUser.name.charAt(0).toUpperCase() : "J";
    
    if (activeAvatarImage) {
        preview.style.backgroundImage = `url(${activeAvatarImage})`;
        preview.textContent = "";
    } else {
        preview.style.backgroundImage = "none";
        preview.style.backgroundColor = activeAvatarBg;
        preview.style.color = "white";
        preview.textContent = initials;
    }
}

function saveUploadPhoto() {
    currentUser.avatarBg = activeAvatarBg;
    currentUser.avatarImg = activeAvatarImage;
    
    localStorage.setItem('vast_user', JSON.stringify(currentUser));
    updateProfileUI();
    populateSettingsInputs();
    closeUploadPhotoModal();
    showSystemToast("Avatar profile picture updated successfully!");
}

// Helper: Convert RGB background back to Hex for comparison matches
function rgb2hex(rgb) {
    if (/^#[0-9A-F]{6}$/i.test(rgb)) return rgb;
    rgb = rgb.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/);
    function hex(x) {
        return ("0" + parseInt(x).toString(16)).slice(-2);
    }
    return rgb ? "#" + hex(rgb[1]) + hex(rgb[2]) + hex(rgb[3]) : rgb;
}

// 2. Add Email Modal (`Add email account.png`)
function openAddEmailModal() {
    document.getElementById('addEmailModal').classList.add('active');
    document.getElementById('modalAddEmail').value = '';
    document.getElementById('modalAddPassword').value = '';
}

function closeAddEmailModal() {
    document.getElementById('addEmailModal').classList.remove('active');
}

function handleAddEmailSubmit(event) {
    event.preventDefault();
    const newEmail = document.getElementById('modalAddEmail').value.trim();
    
    if (extraEmails.includes(newEmail) || newEmail === document.getElementById('settingsEmail').value) {
        showSystemToast("Account email is already connected.");
        return;
    }

    extraEmails.push(newEmail);
    saveLocalDatabase();
    renderExtraEmails();
    closeAddEmailModal();
    showSystemToast(`Successfully added account: ${newEmail}`);
}

// Render connected emails dynamically
function renderExtraEmails() {
    const container = document.getElementById('additionalEmailsContainer');
    container.innerHTML = '';
    
    extraEmails.forEach((em, index) => {
        const group = document.createElement('div');
        group.className = 'auth-form-group';
        group.style.marginTop = '10px';
        group.innerHTML = `
            <label>Secondary Account #${index + 1}</label>
            <div style="display:flex; gap:8px; align-items:center;">
                <input type="email" class="auth-input" value="${em}" readonly style="margin-bottom:0; flex-grow:1;">
                <button class="delete-task-btn" style="background:#FEE2E2; color:#B91C1C; height:44px; width:44px; border-radius:12px;" onclick="removeSecondaryEmail(${index})">&times;</button>
            </div>
        `;
        container.appendChild(group);
    });
}

function removeSecondaryEmail(index) {
    const removed = extraEmails.splice(index, 1);
    saveLocalDatabase();
    renderExtraEmails();
    showSystemToast(`Removed secondary account: ${removed}`);
}

function deleteEmailAccount() {
    if (confirm("Are you sure you want to delete your VAST account permanently? All tasks and settings will be lost.")) {
        localStorage.clear();
        currentUser = null;
        applySessionLogout();
        showSystemToast("Account deleted. Re-routing back to registration.");
    }
}

// 3. Language Selection Modal (`Select language.png`)
function openLanguageModal() {
    document.getElementById('languageModal').classList.add('active');
    document.getElementById('langSearchInput').value = '';
    renderLanguagesList(languagesData);
}

function closeLanguageModal() {
    document.getElementById('languageModal').classList.remove('active');
}

function renderLanguagesList(dataList) {
    const container = document.getElementById('languageListContainer');
    container.innerHTML = '';
    
    dataList.forEach(item => {
        const isSelected = item.name === selectedLang;
        const div = document.createElement('div');
        div.className = `popup-list-item ${isSelected ? 'selected' : ''}`;
        div.onclick = () => {
            selectAppLanguage(item.name);
        };
        
        div.innerHTML = `
            <div>
                <h4 style="font-size:14px; font-weight:600; color:var(--text-main);">${item.name}</h4>
                ${item.sub ? `<p style="font-size:11px; color:var(--text-muted); margin-top:2px;">${item.sub}</p>` : ''}
            </div>
            <div class="popup-radio-dot"></div>
        `;
        container.appendChild(div);
    });
}

// Filter language matches dynamically
function filterLanguages() {
    const q = document.getElementById('langSearchInput').value.toLowerCase();
    const filtered = languagesData.filter(l => 
        l.name.toLowerCase().includes(q) || (l.sub && l.sub.toLowerCase().includes(q))
    );
    renderLanguagesList(filtered);
}

// 4. Region Selection Modal (`Region and format.png`)
function openRegionModal() {
    document.getElementById('regionModal').classList.add('active');
    document.getElementById('regionSearchInput').value = '';
    renderRegionsList(regionsData);
}

function closeRegionModal() {
    document.getElementById('regionModal').classList.remove('active');
}

function renderRegionsList(dataList) {
    const container = document.getElementById('regionListContainer');
    container.innerHTML = '';
    
    dataList.forEach(item => {
        const isSelected = item.name === selectedRegion;
        const div = document.createElement('div');
        div.className = `popup-list-item ${isSelected ? 'selected' : ''}`;
        div.onclick = () => {
            selectAppRegion(item.name);
        };
        
        div.innerHTML = `
            <div>
                <h4 style="font-size:14px; font-weight:600; color:var(--text-main);">${item.name}</h4>
                <p style="font-size:11px; color:var(--text-muted); margin-top:2px;">${item.sub}</p>
            </div>
            <div class="popup-radio-dot"></div>
        `;
        container.appendChild(div);
    });
}

function selectAppRegion(regionName) {
    selectedRegion = regionName;
    populateSettingsInputs();
    closeRegionModal();
    showSystemToast(`Region format calibrated to: ${regionName}`);
}

// Filter regions dynamically
function filterRegions() {
    const q = document.getElementById('regionSearchInput').value.toLowerCase();
    const filtered = regionsData.filter(r => 
        r.name.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q)
    );
    renderRegionsList(filtered);
}

// --- OVERLAYS AND HEADER ACTIONS ---
function closeAllHeaderPopups() {
    notifDropdown.classList.remove('open');
    profileDropdown.classList.remove('open');
    bellBtn.classList.remove('active-badge');
    profileBtn.classList.remove('active-badge');
}

bellBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = notifDropdown.classList.toggle('open');
    profileDropdown.classList.remove('open');
    profileBtn.classList.remove('active-badge');
    bellBtn.classList.toggle('active-badge', isOpen);
    if (isOpen) renderNotifications();
});

profileBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = profileDropdown.classList.toggle('open');
    notifDropdown.classList.remove('open');
    bellBtn.classList.remove('active-badge');
    profileBtn.classList.toggle('active-badge', isOpen);
});

document.addEventListener('click', () => {
    closeAllHeaderPopups();
});

// Prevention inside popup propagation bounds
notifDropdown.addEventListener('click', (e) => e.stopPropagation());
profileDropdown.addEventListener('click', (e) => e.stopPropagation());

function renderNotifications() {
    const container = document.getElementById('notifList');
    container.innerHTML = '';
    
    if (localNotifications.length === 0) {
        container.innerHTML = '<div class="no-tasks" style="padding: 20px 0;">No new notifications</div>';
        document.getElementById('notifBadge').style.display = 'none';
        return;
    }

    document.getElementById('notifBadge').style.display = 'block';

    localNotifications.forEach(notif => {
        const item = document.createElement('div');
        item.className = `notif-item ${notif.type || ''}`;
        item.innerHTML = `
            <div class="notif-title">${escapeHTML(notif.title)}</div>
            <div class="notif-desc">${escapeHTML(notif.desc)}</div>
            <div class="notif-time">${notif.time}</div>
        `;
        container.appendChild(item);
    });
}

function clearNotifications() {
    localNotifications = [];
    saveLocalDatabase();
    renderNotifications();
    showSystemToast("All notifications cleared.");
}

function addSystemNotification(title, desc, time = "Just now", type = "upcoming") {
    localNotifications.unshift({
        id: Date.now(),
        title,
        desc,
        time,
        type
    });
    saveLocalDatabase();
    renderNotifications();
}

// --- NAVIGATION PANEL ROUTER ---
async function navigateTo(panelName) {
    dashboardPanel.classList.remove('active');
    calendarPanel.classList.remove('active');
    document.getElementById('settings-panel').classList.remove('active');
    
    document.getElementById('navHome').classList.remove('active');
    document.getElementById('navCalendar').classList.remove('active');

    closeAllHeaderPopups();

    if (panelName === 'dashboard') {
        dashboardPanel.classList.add('active');
        document.getElementById('navHome').classList.add('active');
        fetchDashboardData();
    } else if (panelName === 'calendar') {
        calendarPanel.classList.add('active');
        document.getElementById('navCalendar').classList.add('active');
        await fetchDashboardData();
        renderCalendarMatrix();
        inspectCalendarSelectedDayTasks();
    } else if (panelName === 'settings') {
        document.getElementById('settings-panel').classList.add('active');
        populateSettingsInputs();
        switchSettingsTab('profile');
    }
}

// --- INTERACTIVE WEB SPEECH & INTELLIGENT PARSER ---
function initVoiceRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
        console.warn("Natively hosted Speech Recognition engines absent. Loading Simulated Voice Interface.");
        micBtn.addEventListener('click', () => {
            simulateVocalPrompt();
        });
        return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.lang = 'en-US';
    recognition.interimResults = true;

    let finalTranscript = '';
    let shouldKeepListening = false;
    let submitTimer = null;
    let isRecognitionRunning = false;

    function queueVoiceSubmit(delay = 2200) {
        clearTimeout(submitTimer);
        submitTimer = setTimeout(() => {

            shouldKeepListening = false;
            processCapturedSpeech(finalTranscript.trim());
            if (isRecognitionRunning) {
                try {
                    recognition.stop();
                } catch (e) {
                    console.warn("Speech recognition stop error:", e);
                }
            }

        }, delay);
    }

    micBtn.addEventListener('click', () => {
        if (micBtn.classList.contains('listening')) {
            shouldKeepListening = false;
            processCapturedSpeech(finalTranscript.trim());

            if (isRecognitionRunning) {
                try {
                    recognition.stop();
                } catch (e) {
                    console.warn("Speech recognition stop error:", e);
                }
            }

        } else {
            finalTranscript = '';
            shouldKeepListening = true;
            if (!isRecognitionRunning) {
                try {
                    recognition.start();
                } catch (e) {
                    console.warn("Speech recognition start error:", e);
                    showSystemToast("Microphone unavailable. Try again shortly.");
                }
            }
        }
    });

    recognition.onstart = () => {
        isRecognitionRunning = true;
        micBtn.classList.add('listening');
        voiceToast.style.display = "block";
        triggerVocalResponse("Speak now, I'm listening.");
    };

    recognition.onend = () => {
        isRecognitionRunning = false;
        if (shouldKeepListening) {
            try {
                recognition.start();
            } catch (e) {
                console.warn("Speech restart skipped:", e);
            }
            return;
        }
        micBtn.classList.remove('listening');
        voiceToast.style.display = "none";
    };

    recognition.onerror = (event) => {
        console.error("Vocal engine capture error: ", event.error);
        shouldKeepListening = false;
        clearTimeout(submitTimer);
        micBtn.classList.remove('listening');
        voiceToast.style.display = "none";
        showSystemToast("Vocal error captured: " + event.error);
    };

    recognition.onresult = (event) => {
        for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcriptPart = event.results[i][0].transcript.trim();
            if (event.results[i].isFinal && transcriptPart) {
                finalTranscript = `${finalTranscript} ${transcriptPart}`.trim();
            }
        }
        queueVoiceSubmit();
    };
}

// --- INTELLIGENT VOCAL NATURAL LANGUAGE PARSING ENGINE ---
async function processCapturedSpeech(phrase) {
    if (!phrase) return;
    console.log("Processing captured phrase:", phrase);
    showSystemToast(`Heard: "${phrase}"`);

    try {

        const response = await apiFetch(ENDPOINTS.voice, {
            method: 'POST',

            body: JSON.stringify({ transcript: phrase })
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));

            const errorText = formatApiError(errorBody);
            const authMessage = (response.status === 401 || response.status === 403)
                ? ' Please sign in before using voice commands.'
                : '';
            showSystemToast(`Voice task failed: ${errorText}.${authMessage}`);

            return;
        }

        const task = await response.json();
        renderedTaskCache[task.id] = task;
        showSystemToast(`Successfully parsed Voice Task: "${task.title}"`);
        triggerVocalResponse(`Task added: ${task.title}`);
        navigateTo('dashboard');
    } catch (err) {
        console.error("Voice task backend request failed:", err);
        showSystemToast("Voice task failed. Check if Django is running.");
    }
}

// Voice simulator fallback for non-Chrome platforms
function simulateVocalPrompt() {
    const mockCommand = prompt(
        "V.A.S.T. Vocal Command Interface Sandbox Simulator:\n\n" +
        "Try typing vocal statements like:\n" +
        "• 'Add math quiz tomorrow at 03:00 PM priority high'\n" +
        "• 'Add buy milk today at 08:30 AM'\n" +
        "• 'Add presentation on May 18 at 01:00 PM'"
    );
    if (mockCommand) {
        processCapturedSpeech(mockCommand);
    }
}

// Custom SpeechSynthesis utility
function triggerVocalResponse(phrase) {
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(phrase);
        utterance.pitch = 1.0;
        utterance.rate = 1.0;
        window.speechSynthesis.speak(utterance);
    }
}

// --- INTERACTION UTILITY HELPERS ---
function toggleModal(show) {
    taskModal.classList.toggle('active', show);
}

openModalBtn.addEventListener('click', () => toggleModal(true));
closeModalBtn.addEventListener('click', () => toggleModal(false));
taskModal.addEventListener('click', (e) => {
    if (e.target === taskModal) toggleModal(false);
});

function showSystemToast(message) {
    systemAlert.textContent = message;
    systemAlert.style.display = 'flex';
    setTimeout(() => {
        systemAlert.style.display = 'none';
    }, 3500);
}

// Time format utility
function formatTime(timeString) {
    if (!timeString) return '';
    const [hours, minutes] = timeString.split(':');
    let hourInt = parseInt(hours, 10);
    const ampm = hourInt >= 12 ? 'PM' : 'AM';
    hourInt = hourInt % 12 || 12;
    return `${String(hourInt).padStart(2, '0')}:${minutes} ${ampm}`;
}

function formatShortDate(dateStr) {
    const dateObj = new Date(dateStr);
    const options = { month: 'short', day: 'numeric' };
    return dateObj.toLocaleDateString('en-US', options);
}

function getTodayDateString() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function normalizeTimeForInput(timeString) {
    if (!timeString) return "09:00";
    return timeString.slice(0, 5);
}

// Prevent injection vulnerabilities
function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[tag] || tag));
}

function formatApiError(errorBody) {

    if (!errorBody || typeof errorBody !== 'object') {
        return 'Request failed. Check the browser console.';
    }
    if (errorBody.detail) {
        return errorBody.detail;
    }

    if (errorBody.error) {
        return errorBody.error;
    }

    return Object.entries(errorBody)
        .map(([field, messages]) => `${field}: ${Array.isArray(messages) ? messages.join(', ') : messages}`)
        .join('\n') || 'Request failed. Check the browser console.';
}