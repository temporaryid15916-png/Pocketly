/* POCKETLY standalone bundle: finance + translations + application */

/** POCKETLY ledger math. Amounts are integer poisha (1 taka = 100 poisha). */

const EXPENSE_CATS = [
  "food",
  "transport",
  "education",
  "mobile",
  "shopping",
  "entertainment",
  "care",
  "health",
  "family",
  "other",
];

const INCOME_CATS = ["allowance", "gift", "other_income"];

const PAY_METHODS = ["cash", "bkash", "nagad", "rocket", "bank", "card", "other"];

function toPoisha(taka) {
  const n = typeof taka === "string" ? Number(taka.trim()) : Number(taka);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function validPositivePoisha(taka) {
  const p = toPoisha(taka);
  if (p == null || p <= 0 || p > 10_000_000_000) return null;
  return p;
}

function validNonNegativePoisha(taka) {
  const p = toPoisha(taka);
  if (p == null || p < 0 || p > 10_000_000_000) return null;
  return p;
}

function monthDays(key) {
  const [year, month] = String(key).split("-").map(Number);
  if (!year || !month) return 30;
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function previousMonthKey(key) {
  const [year, month] = String(key).split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function shiftMonth(key, delta) {
  let [year, month] = String(key).split("-").map(Number);
  month += delta;
  while (month < 1) {
    month += 12;
    year -= 1;
  }
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  return `${year}-${String(month).padStart(2, "0")}`;
}

function dhakaParts(date = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(date)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  const dateStr = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    date: dateStr,
    time: `${parts.hour}:${parts.minute}`,
    stamp: `${dateStr}T${parts.hour}:${parts.minute}`,
    key: `${parts.year}-${parts.month}`,
    day: Number(parts.day),
    year: Number(parts.year),
    month: Number(parts.month),
    hour: Number(parts.hour),
  };
}

function sumAmount(list) {
  return list.reduce((s, t) => s + (Number(t.amount) || 0), 0);
}

function inMonth(tx, key) {
  return String(tx?.occurredAt || "").slice(0, 7) === key;
}

function calculateBudget({ transactions, budget, monthRecord, parts }) {
  const key = parts.key;
  const monthTx = transactions.filter((tx) => inMonth(tx, key));
  const income = sumAmount(monthTx.filter((t) => t.type === "income"));
  const expenses = sumAmount(monthTx.filter((t) => t.type === "expense"));
  const savedOut = sumAmount(monthTx.filter((t) => t.type === "savings" && t.direction !== "in"));
  const savedIn = sumAmount(monthTx.filter((t) => t.type === "savings" && t.direction === "in"));
  const starting = monthRecord?.startingMoney ?? budget.monthlyStartingMoney ?? 0;
  const carry = monthRecord?.carryIn || 0;
  const savingsTarget = budget.savingsTarget || 0;
  const fixedExpenses = budget.fixedExpenses || 0;
  const emergencyReserve = budget.emergencyReserve || 0;
  const reserved = savingsTarget + fixedExpenses + emergencyReserve;
  const spendable = starting + carry + income - reserved;
  const remaining = spendable - expenses;
  const daysInMonth = monthDays(key);
  const daysLeft = Math.max(1, daysInMonth - parts.day + 1);
  const recommendedDaily = Math.max(0, remaining) / daysLeft;
  const today = parts.date;
  const spentToday = sumAmount(
    monthTx.filter((t) => t.type === "expense" && String(t.occurredAt).slice(0, 10) === today),
  );
  const dailyLimit = budget.dailyLimit || 0;
  const available = starting + carry + income - expenses - savedOut + savedIn;
  return {
    key,
    income,
    expenses,
    savedOut,
    savedIn,
    netSavings: savedOut - savedIn,
    starting,
    carry,
    savingsTarget,
    fixedExpenses,
    emergencyReserve,
    reserved,
    spendable,
    remaining,
    daysInMonth,
    daysLeft,
    recommendedDaily,
    spentToday,
    dailyLimit,
    dailyRemaining: dailyLimit - spentToday,
    available,
    todayGuide: budget.mode === "fixed" ? dailyLimit : recommendedDaily,
    monthTx,
  };
}

function daySpendMap(transactions, key) {
  const map = {};
  for (const tx of transactions) {
    if (tx.type !== "expense" || !inMonth(tx, key)) continue;
    const day = String(tx.occurredAt).slice(0, 10);
    map[day] = (map[day] || 0) + (Number(tx.amount) || 0);
  }
  return map;
}

function goalBalance(transactions, goalId) {
  return transactions.reduce((s, t) => {
    if (t.type !== "savings" || t.goalId !== goalId) return s;
    return s + (t.direction === "in" ? -Number(t.amount || 0) : Number(t.amount || 0));
  }, 0);
}

function unassignedSavings(transactions) {
  return transactions.reduce((s, t) => {
    if (t.type !== "savings" || t.goalId) return s;
    return s + (t.direction === "in" ? -Number(t.amount || 0) : Number(t.amount || 0));
  }, 0);
}

function totalGoalSavings(transactions, goals) {
  return goals.reduce((s, g) => s + goalBalance(transactions, g.id), 0) + unassignedSavings(transactions);
}

function discipline(transactions, budget, monthRecord, parts) {
  const summary = calculateBudget({ transactions, budget, monthRecord, parts });
  const monthCount = transactions.filter((t) => inMonth(t, parts.key)).length;
  if (monthCount < 3) return { ready: false, summary };
  const days = parts.day;
  const spend = daySpendMap(transactions, parts.key);
  const evenGuide = summary.daysInMonth > 0 ? Math.max(0, summary.spendable) / summary.daysInMonth : 0;
  const guide = budget.mode === "fixed" ? summary.dailyLimit : evenGuide;
  let within = 0;
  let noSpend = 0;
  for (let d = 1; d <= days; d++) {
    const stamp = `${parts.key}-${String(d).padStart(2, "0")}`;
    const amount = spend[stamp] || 0;
    if (amount <= guide + 0.5) within += 1;
    if (amount === 0) noSpend += 1;
  }
  let noSpendStreak = 0;
  let withinStreak = 0;
  for (let d = days; d >= 1; d--) {
    const stamp = `${parts.key}-${String(d).padStart(2, "0")}`;
    if ((spend[stamp] || 0) === 0) noSpendStreak += 1;
    else break;
  }
  for (let d = days; d >= 1; d--) {
    const stamp = `${parts.key}-${String(d).padStart(2, "0")}`;
    if ((spend[stamp] || 0) <= guide + 0.5) withinStreak += 1;
    else break;
  }
  const withinScore = days ? (within / days) * 50 : 0;
  let budgetScore = 0;
  if (summary.spendable <= 0) budgetScore = summary.expenses === 0 ? 30 : 0;
  else if (summary.remaining >= 0) budgetScore = 30;
  else budgetScore = Math.max(0, 30 * (1 + summary.remaining / summary.spendable));
  let saveScore = 20;
  if (summary.savingsTarget > 0) {
    saveScore = Math.max(0, Math.min(20, (summary.netSavings / summary.savingsTarget) * 20));
  } else if (summary.remaining < 0) saveScore = 0;
  const score = Math.round(Math.max(0, Math.min(100, withinScore + budgetScore + saveScore)));
  return {
    ready: true,
    score,
    within,
    days,
    noSpend,
    noSpendStreak,
    withinStreak,
    guide,
    summary,
  };
}

function bestCategoryInsight(transactions, parts) {
  const prev = previousMonthKey(parts.key);
  const cats = new Set();
  for (const tx of transactions) {
    if (tx.type === "expense") cats.add(tx.category);
  }
  let best = null;
  for (const category of cats) {
    const cur = sumAmount(
      transactions.filter(
        (t) => t.type === "expense" && t.category === category && inMonth(t, parts.key),
      ),
    );
    const old = sumAmount(
      transactions.filter((t) => t.type === "expense" && t.category === category && inMonth(t, prev)),
    );
    if (cur <= 0 || old <= 0) continue;
    const pct = Math.round(((cur - old) / old) * 100);
    if (Math.abs(pct) < 10) continue;
    if (!best || Math.abs(pct) > Math.abs(best.pct)) best = { category, pct, cur, old };
  }
  return best;
}

function whatIf(summary, extraExpense, extraIncome) {
  const remaining = summary.remaining - (extraExpense || 0) + (extraIncome || 0);
  const daily = Math.max(0, remaining) / Math.max(1, summary.daysLeft);
  return { remaining, daily };
}

function availableAtMonthEnd(transactions, budget, monthRecord, key) {
  const days = monthDays(key);
  const parts = { key, day: days, date: `${key}-${String(days).padStart(2, "0")}` };
  return calculateBudget({ transactions, budget, monthRecord, parts });
}

function weekBuckets(transactions, key) {
  const days = monthDays(key);
  const buckets = [];
  for (let start = 1; start <= days; start += 7) {
    const end = Math.min(days, start + 6);
    let expense = 0;
    let income = 0;
    for (const tx of transactions) {
      if (!inMonth(tx, key)) continue;
      const day = Number(String(tx.occurredAt).slice(8, 10));
      if (day < start || day > end) continue;
      if (tx.type === "expense") expense += tx.amount;
      if (tx.type === "income") income += tx.amount;
    }
    buckets.push({ start, end, expense, income, label: `${start}–${end}` });
  }
  return buckets;
}

function monthSeries(transactions, endKey, count = 6) {
  const keys = [];
  for (let i = count - 1; i >= 0; i--) keys.push(shiftMonth(endKey, -i));
  return keys.map((key) => ({
    key,
    expense: sumAmount(transactions.filter((t) => t.type === "expense" && inMonth(t, key))),
    income: sumAmount(transactions.filter((t) => t.type === "income" && inMonth(t, key))),
  }));
}

function defaultBudget() {
  return {
    mode: "smart",
    monthlyStartingMoney: 0,
    savingsTarget: 0,
    fixedExpenses: 0,
    emergencyReserve: 0,
    dailyLimit: 15000,
  };
}

function blankState() {
  return {
    version: 1,
    profile: null,
    settings: {
      language: "en",
      theme: "system",
      notifications: {
        dailyReminder: true,
        budgetWarning: true,
        lowBalance: true,
        monthWarning: true,
        savings: true,
        monthlySummary: true,
      },
    },
    budget: defaultBudget(),
    months: {},
    categories: [],
    transactions: [],
    goals: [],
    notificationLog: [],
    sample: false,
  };
}

function normalize(raw) {
  const base = blankState();
  if (!raw || typeof raw !== "object") return base;
  const settings = { ...base.settings, ...(raw.settings || {}) };
  settings.notifications = { ...base.settings.notifications, ...(raw.settings?.notifications || {}) };
  if (settings.language !== "bn") settings.language = "en";
  if (!["dark", "light", "system"].includes(settings.theme)) settings.theme = "system";
  return {
    version: 1,
    profile: raw.profile && raw.profile.name ? raw.profile : null,
    settings,
    budget: { ...base.budget, ...(raw.budget || {}) },
    months: raw.months && typeof raw.months === "object" ? raw.months : {},
    categories: Array.isArray(raw.categories) ? raw.categories : [],
    transactions: Array.isArray(raw.transactions)
      ? raw.transactions.filter((tx) => tx && typeof tx.occurredAt === "string" && Number.isFinite(Number(tx.amount)) && tx.amount >= 0)
      : [],
    goals: Array.isArray(raw.goals) ? raw.goals.filter((g) => g && g.id && g.name) : [],
    notificationLog: Array.isArray(raw.notificationLog) ? raw.notificationLog : [],
    sample: Boolean(raw.sample),
  };
}


const STR = {
  en: {
    appName: "POCKETLY",
    tagline: "Smart Money. Better Life.",
    kicker: "Personal pocket money",
    welcomeTitle: "Make every taka count.",
    welcomeBody:
      "Track pocket money, daily spending and savings on this device. No account server, so it opens straight from GitHub Pages.",
    yourName: "What should we call you?",
    namePh: "Your name",
    startFresh: "Start my ledger",
    loadSample: "Explore a sample month",
    privacyNote: "Records stay in this browser until you export them. Nothing is sent to a bank or a server.",
    yourName: "Your name",
    startLedger: "Create my ledger",
    welcomeLead: "Track pocket money, daily spending and savings on this device. Private and offline-first.",
    sampleNote: "Sample numbers are labelled and can be erased from Settings.",
    lockTitle: "Pocketly is locked",
    lockHint: "Enter your 4-digit PIN.",
    unlock: "Unlock",
    wrongPin: "That PIN does not match.",
    pin4: "Use 4 digits.",
    enterPin: "Choose a 4-digit PIN",
    reenterPin: "Enter the same PIN again",
    pinMismatch: "Those PINs did not match. Try again.",
    pinOn: "PIN lock is on.",
    pinOff: "PIN lock is off.",
    navDash: "Home",
    navHistory: "History",
    navBudget: "Budget",
    navSavings: "Savings",
    navInsights: "Insights",
    navMonths: "Months",
    navAlerts: "Alerts",
    navSettings: "Settings",
    navMore: "More",
    add: "Add",
    addExpense: "Add expense",
    addIncome: "Add income",
    toSavings: "Move to savings",
    fromSavings: "Withdraw savings",
    available: "Available balance",
    monthlyStart: "Monthly starting money",
    totalIncome: "Income this month",
    totalExpenses: "Expenses this month",
    remainingBudget: "Remaining budget",
    todayRecommend: "Today's recommended",
    todayActual: "Spent today",
    savingsBalance: "Savings balance",
    daysLeft: "Days left",
    budgetProgress: "Monthly budget used",
    smartMode: "Smart Auto Budget",
    fixedMode: "Fixed Daily Budget",
    recent: "Recent transactions",
    viewAll: "View all",
    noTx: "No transactions yet",
    noTxHint: "Add income, an expense, or a savings transfer. Nothing here is invented.",
    emptyFilter: "Nothing matches these filters.",
    spent: "Spent",
    ofSpendable: "of the spendable budget",
    adapts: "Updates from the money you still have and the days left. Unused daily money stays in the monthly pool.",
    fixedHint: "Same limit every day. Going over today does not reset the rest of the month's records.",
    quick: "Quick actions",
    snapshot: "This month",
    hello: "Hello",
    search: "Search notes, categories, methods",
    allTypes: "All types",
    income: "Income",
    expense: "Expense",
    savings: "Savings",
    newest: "Newest",
    oldest: "Oldest",
    high: "Highest amount",
    low: "Lowest amount",
    thisMonth: "This month",
    lastMonth: "Last month",
    allTime: "All time",
    custom: "Custom dates",
    from: "From",
    to: "To",
    historyTitle: "Transaction history",
    historySub: "Income, expenses and savings transfers stay until you delete them.",
    save: "Save",
    cancel: "Cancel",
    delete: "Delete",
    edit: "Edit",
    close: "Close",
    amount: "Amount (৳)",
    category: "Category",
    date: "Date",
    time: "Time",
    method: "Payment method",
    description: "Description",
    notes: "Notes",
    goal: "Savings goal",
    type: "Type",
    newTx: "New transaction",
    editTx: "Edit transaction",
    descriptionPh: "What was this for?",
    notesPh: "Optional detail",
    amountInvalid: "Enter an amount greater than zero.",
    nameInvalid: "Enter your name to begin.",
    goalInvalid: "Enter a goal name and a target above zero.",
    needGoal: "Choose a goal, or General savings.",
    insufficient: "That withdrawal is larger than the saved amount.",
    saved: "Saved.",
    deleted: "Deleted.",
    budgetSaved: "Budget updated. Past transactions were not changed.",
    confirmBudget: "Apply this budget? Your transaction history stays as it is.",
    confirmDeleteTx: "Delete this transaction? Balances will be recalculated.",
    confirmDeleteGoal: "Delete this goal? Its transfers stay in history as general savings.",
    cash: "Cash",
    bkash: "bKash",
    nagad: "Nagad",
    rocket: "Rocket",
    bank: "Bank",
    card: "Card",
    otherPay: "Other",
    "cat.food": "Food",
    "cat.transport": "Transportation",
    "cat.education": "Education",
    "cat.mobile": "Mobile & Internet",
    "cat.shopping": "Shopping",
    "cat.entertainment": "Entertainment",
    "cat.care": "Personal Care",
    "cat.health": "Health",
    "cat.family": "Family",
    "cat.other": "Other",
    "cat.allowance": "Additional allowance",
    "cat.gift": "Gift",
    "cat.other_income": "Other income",
    generalSavings: "General savings",
    customCat: "Custom category",
    addCategory: "Add category",
    catAdded: "Category added.",
    catName: "New category name",
    budgetTitle: "Budget",
    budgetSub: "Two modes. Switching never deletes history.",
    smartExplain: "Daily guidance is remaining spendable money divided by the days left in the month, Dhaka time.",
    fixedExplain: "You set one daily limit. Pocketly warns you when today passes it.",
    startingMoney: "Monthly starting money (৳)",
    savingsTarget: "Savings target (৳)",
    fixedReserved: "Reserved fixed costs (৳)",
    emergency: "Emergency reserve (৳)",
    dailyLimit: "Daily limit (৳)",
    applyBudget: "Save budget",
    reservedNote:
      "Targets and reserves are plans, not transactions. Record real spending as expenses so it is not counted twice.",
    broughtIn: "Brought in from last month",
    pocketExplainer: "This is your pocket money for the month. Extra money you receive is added as income.",
    includedCarry: "Included in the starting pool. It is not a new income record.",
    remainingNow: "Remaining this month",
    limit: "Daily limit",
    spentTodayLabel: "Spent today",
    remainingToday: "Left today",
    usage: "Of today's limit",
    overToday: "Today is over the daily limit.",
    withinToday: "Today is inside the daily limit.",
    goalsTitle: "Savings",
    goalsSub: "Transfers move money inside your ledger. They are not income or expenses.",
    newGoal: "New goal",
    editGoal: "Edit goal",
    goalName: "Goal name",
    targetAmount: "Target (৳)",
    targetDate: "Target date",
    savedOf: "saved of",
    toGo: "to go",
    deposit: "Deposit",
    withdraw: "Withdraw",
    noGoals: "No savings goals yet",
    noGoalsHint: "Create a goal, then move money into it.",
    goalPh: "Buy a smartphone",
    savedAcross: "Saved across goals",
    unassigned: "Not assigned to a goal",
    goalMoves: "Movements",
    noMoves: "No deposits yet.",
    insightsTitle: "Insights",
    insightsSub: "Figures come only from transactions you recorded.",
    notEnough: "Not enough transactions this month for a score or a comparison.",
    notEnoughHint: "Add at least three records this month. Pocketly will not invent a trend.",
    score: "Discipline score",
    noSpendDays: "No-spend days",
    noSpendStreak: "No-spend streak",
    withinStreak: "Within-guide streak",
    daysWithin: "Days inside the guide",
    highestCat: "Highest spending category",
    avgDaily: "Average daily spend",
    monthSpend: "Spent this month",
    vsLast: "Against last month",
    noCompare: "Last month does not have enough spending to compare.",
    catMore: "You spent {pct}% more on {cat} this month compared with last month.",
    catLess: "You spent {pct}% less on {cat} this month compared with last month.",
    whatIf: "What-if calculator",
    whatIfHint: "This does not change your ledger.",
    extraExpense: "If I spend (৳)",
    extraIncome: "If I receive (৳)",
    newDaily: "Recommended daily would be",
    newRemaining: "Remaining budget would be",
    byCategory: "Spending by category",
    dailyChart: "Daily spending",
    monthlyChart: "Income and expenses",
    weekly: "This month by week",
    incomeVs: "Income vs expenses",
    noChart: "Add records to draw this chart.",
    monthsTitle: "Monthly history",
    monthsSub: "Each month keeps its own records. Old income is never copied in as new income.",
    carryAsk: "A new month has started",
    carryBody: "{month} still has {amount} available. Carry it into {next}, or start that month fresh?",
    carryYes: "Carry remaining money",
    carryNo: "Start fresh",
    noSurplus: "{month} has no surplus to carry. Start {next} fresh.",
    noSurplusOk: "Start fresh",
    alertsTitle: "Alerts",
    alertsEmpty: "No alerts yet.",
    alertsSub: "Warnings appear when your own records cross a limit.",
    markRead: "Mark all read",
    enableBrowser: "Allow browser notifications",
    notifExplain:
      "Pocketly can notify you while this page is open, or just after you open it. A static GitHub Pages site cannot wake your phone when the app is fully closed, because there is no background server.",
    permGranted: "Browser notifications are allowed on this device.",
    permDenied: "Browser permission was denied. In-app alerts still work.",
    permNA: "This browser does not offer notifications here.",
    dailyReminder: "Daily spending reminder",
    budgetWarning: "Budget limit warning",
    lowBalance: "Low balance warning",
    monthWarning: "Month ending soon",
    savingsUpdates: "Savings goal updates",
    monthlySummary: "Monthly summary",
    alertDaily: "No spending recorded today. Add an expense only if you actually spent.",
    alertOverMonth: "This month's variable spending is over the spendable budget.",
    alertOverDay: "Today's spending is over your daily limit.",
    alertLow: "Available balance is under ৳500.",
    alertMonth: "Three days or fewer remain in this Dhaka month.",
    alertGoal: "You reached the goal “{name}”.",
    alertSummary: "Last month: income {income}, expenses {expense}.",
    settingsTitle: "Settings",
    settingsSub: "Language, theme, PIN, backup.",
    language: "Language",
    appearance: "Appearance",
    dark: "Dark",
    light: "Light",
    system: "System default",
    currencyLine: "Bangladeshi Taka (৳) · Asia/Dhaka",
    backup: "Backup",
    backupHint: "JSON backup includes every record. CSV is a spreadsheet of transactions. Keep the files private.",
    exportJson: "Download JSON backup",
    exportCsv: "Download CSV",
    importJson: "Restore JSON backup",
    restored: "Backup restored.",
    invalidFile: "That file is not a Pocketly backup.",
    erase: "Erase all data on this device",
    eraseHint: "Type DELETE to confirm. This cannot be undone.",
    eraseConfirm: "Erase everything stored by Pocketly in this browser?",
    wiped: "All local data was erased.",
    typeDelete: "DELETE",
    pin: "App PIN",
    setPin: "Set a PIN",
    changePin: "Change PIN",
    removePin: "Remove PIN",
    removePinConfirm: "Remove the PIN lock?",
    about: "About Pocketly",
    aboutBody:
      "Pocketly is a personal pocket-money ledger. It does not connect to bKash, banks or Nagad. Balances are calculated from what you enter. Cloud sign-in is not included, so the site can be published as plain files with no build step.",
    security: "Security",
    securityBody: "The PIN is stored as a salted hash, not as the digits themselves. Biometric unlock needs a native app and is not claimed here.",
    dataStays: "On this device",
    lock: "Lock",
    profile: "Profile",
    confirmTitle: "Please confirm",
    yes: "Confirm",
    no: "Cancel",
    today: "Today",
    over: "Over",
    left: "left",
    week: "Week",
    total: "Total",
    optional: "Optional",
    progress: "Progress",
    required: "Required",
    modeSmartShort: "Smart",
    modeFixedShort: "Fixed",
    guide: "Guide",
    actual: "Actual",
    plan: "Plan",
    used: "used",
    days: "days",
    scoreHint: "Half the score is days inside your guide, 30 points is staying inside the monthly pool, 20 points is savings progress.",
    avgHint: "Expenses divided by days elapsed this month, including today.",
    chartIncome: "Income",
    chartExpense: "Expenses",
    moreTitle: "More",
    moreSub: "Budget, insights, months, alerts and settings.",
    sampleBanner: "You are viewing the sample month. Erase it from Settings when you want your own ledger.",
    clearSample: "Erase sample and start over",
    startOverConfirm: "Erase the sample ledger and start empty?",
    noneYet: "—",
    goalDate: "Target",
    percent: "{n}% saved",
    movements: "History for this goal",
    transferOut: "Deposit",
    transferIn: "Withdrawal",
    editShort: "Edit",
    balanceNote: "Starting money + income − expenses − savings deposits + withdrawals.",
    formula: "Spendable = starting money + extra income − savings target − fixed reserve − emergency reserve. Remaining = spendable − expenses.",
    fixedUsage: "Fixed daily budget",
    smartUsage: "Smart daily budget",
    noAlertFilter: "You are inside the limits Pocketly is watching.",
    read: "Read",
    unread: "New",
    dhaka: "Asia/Dhaka",
    savePrefs: "Preferences save automatically.",
    fileReady: "Your file is downloading.",
    remainingFunds: "Remaining funds",
    startMoneyThis: "Starting money this month",
    carryDone: "This month now includes the remaining money.",
    freshDone: "This month starts without last month's surplus.",
    openAdd: "What do you want to record?",
    source: "Source",
    signedLocal: "Local ledger",
    version: "Static edition",
    install: "Add to Home Screen from the browser menu to use it like an app. It still stores data on this device.",
    calToday: "Today",
    overDay: "Over guide",
    quietDay: "No spend",
    legendSpend: "Spent",
    prevShort: "Previous",
    thisShort: "This month",
    delta: "Change",
    higher: "higher",
    lower: "lower",
    same: "about the same",
    expenseShare: "Share of expenses",
    goalRemain: "Remaining",
    created: "Goal saved.",
    txSaved: "Transaction saved.",
    welcomeAside: "November-style clarity for everyday taka.",
    previewLabel: "Designed for daily decisions",
    habits: "A remaining-day budget, not a reset every midnight.",
  },
  bn: {
    appName: "POCKETLY",
    tagline: "স্মার্ট টাকা। ভালো জীবন।",
    kicker: "ব্যক্তিগত পকেট মানি",
    welcomeTitle: "প্রতিটি টাকার হিসাব রাখুন।",
    welcomeBody:
      "পকেট মানি, দৈনিক খরচ আর সঞ্চয় এই ডিভাইসেই থাকবে। কোনো সার্ভার অ্যাকাউন্ট নেই, তাই GitHub Pages থেকে সরাসরি খোলে।",
    yourName: "আপনাকে কী নামে ডাকব?",
    namePh: "আপনার নাম",
    startFresh: "খাতা শুরু করি",
    loadSample: "একটি নমুনা মাস দেখি",
    privacyNote: "রেকর্ড এই ব্রাউজারে থাকে, যতক্ষণ না আপনি এক্সপোর্ট করেন। ব্যাংক বা সার্ভারে কিছু যায় না।",
    yourName: "আপনার নাম",
    startLedger: "খাতা শুরু করুন",
    welcomeLead: "এই ডিভাইসে পকেটের টাকা, দৈনিক খরচ ও সঞ্চয় ট্র্যাক করুন। ব্যক্তিগত ও অফলাইন-ফার্স্ট।",
    sampleNote: "নমুনা সংখ্যা চিহ্নিত। সেটিংস থেকে মুছে ফেলা যায়।",
    lockTitle: "Pocketly লক করা",
    lockHint: "৪ সংখ্যার পিন দিন।",
    unlock: "খুলুন",
    wrongPin: "পিন মেলেনি।",
    pin4: "৪টি সংখ্যা দিন।",
    enterPin: "৪ সংখ্যার পিন বাছুন",
    reenterPin: "একই পিন আবার দিন",
    pinMismatch: "দুইবারের পিন এক নয়।",
    pinOn: "পিন লক চালু হয়েছে।",
    pinOff: "পিন লক বন্ধ।",
    navDash: "হোম",
    navHistory: "হিসাব",
    navBudget: "বাজেট",
    navSavings: "সঞ্চয়",
    navInsights: "বিশ্লেষণ",
    navMonths: "মাস",
    navAlerts: "সতর্কতা",
    navSettings: "সেটিংস",
    navMore: "আরও",
    add: "যোগ",
    addExpense: "খরচ যোগ",
    addIncome: "আয় যোগ",
    toSavings: "সঞ্চয়ে সরান",
    fromSavings: "সঞ্চয় থেকে তুলুন",
    available: "ব্যবহারযোগ্য ব্যালেন্স",
    monthlyStart: "মাসের শুরুর টাকা",
    totalIncome: "এই মাসের আয়",
    totalExpenses: "এই মাসের খরচ",
    remainingBudget: "বাকি বাজেট",
    todayRecommend: "আজকের সুপারিশ",
    todayActual: "আজকের খরচ",
    savingsBalance: "সঞ্চয়ের ব্যালেন্স",
    daysLeft: "বাকি দিন",
    budgetProgress: "মাসিক বাজেট ব্যবহৃত",
    smartMode: "স্মার্ট অটো বাজেট",
    fixedMode: "নির্দিষ্ট দৈনিক বাজেট",
    recent: "সাম্প্রতিক লেনদেন",
    viewAll: "সব দেখুন",
    noTx: "এখনো কোনো লেনদেন নেই",
    noTxHint: "আয়, খরচ বা সঞ্চয় যোগ করুন। এখানে কোনো ভুয়া হিসাব নেই।",
    emptyFilter: "এই ফিল্টারে কিছু নেই।",
    spent: "খরচ",
    ofSpendable: "খরচযোগ্য বাজেটের",
    adapts: "বাকি টাকা ও বাকি দিন দিয়ে প্রতিদিন বদলায়। খরচ না হওয়া দৈনিক টাকা মাসিক পুলেই থাকে।",
    fixedHint: "প্রতিদিন একই সীমা। আজ বেশি খরচ হলেও আগের রেকর্ড মুছে যায় না।",
    quick: "দ্রুত কাজ",
    snapshot: "এই মাস",
    hello: "হ্যালো",
    search: "নোট, খাত বা মাধ্যম খুঁজুন",
    allTypes: "সব ধরন",
    income: "আয়",
    expense: "খরচ",
    savings: "সঞ্চয়",
    newest: "নতুন আগে",
    oldest: "পুরনো আগে",
    high: "সবচেয়ে বড় অঙ্ক",
    low: "সবচেয়ে ছোট অঙ্ক",
    thisMonth: "এই মাস",
    lastMonth: "গত মাস",
    allTime: "সব সময়",
    custom: "নিজের তারিখ",
    from: "থেকে",
    to: "পর্যন্ত",
    historyTitle: "লেনদেনের খাতা",
    historySub: "আয়, খরচ ও সঞ্চয় আপনি না মোছা পর্যন্ত থাকবে।",
    save: "সেভ",
    cancel: "বাতিল",
    delete: "মুছুন",
    edit: "সম্পাদনা",
    close: "বন্ধ",
    amount: "পরিমাণ (৳)",
    category: "খাত",
    date: "তারিখ",
    time: "সময়",
    method: "পেমেন্ট মাধ্যম",
    description: "বিবরণ",
    notes: "নোট",
    goal: "সঞ্চয়ের লক্ষ্য",
    type: "ধরন",
    newTx: "নতুন লেনদেন",
    editTx: "লেনদেন সম্পাদনা",
    descriptionPh: "এটি কীসের জন্য?",
    notesPh: "আরও কিছু লিখতে পারেন",
    amountInvalid: "শূন্যের বেশি একটি পরিমাণ দিন।",
    nameInvalid: "শুরু করতে নাম লিখুন।",
    goalInvalid: "লক্ষ্যের নাম ও শূন্যের বেশি টার্গেট দিন।",
    needGoal: "একটি লক্ষ্য বা সাধারণ সঞ্চয় বাছুন।",
    insufficient: "তোলার পরিমাণ জমানোর চেয়ে বেশি।",
    saved: "সেভ হয়েছে।",
    deleted: "মুছে ফেলা হয়েছে।",
    budgetSaved: "বাজেট বদলেছে। পুরনো লেনদেন অপরিবর্তিত।",
    confirmBudget: "এই বাজেট বসাবেন? লেনদেনের ইতিহাস আগের মতোই থাকবে।",
    confirmDeleteTx: "এই লেনদেন মুছবেন? ব্যালেন্স আবার হিসাব হবে।",
    confirmDeleteGoal: "এই লক্ষ্য মুছবেন? এর ট্রান্সফার ইতিহাসে সাধারণ সঞ্চয় হিসেবে থাকবে।",
    cash: "ক্যাশ",
    bkash: "বিকাশ",
    nagad: "নগদ",
    rocket: "রকেট",
    bank: "ব্যাংক",
    card: "কার্ড",
    otherPay: "অন্যান্য",
    "cat.food": "খাবার",
    "cat.transport": "যাতায়াত",
    "cat.education": "শিক্ষা",
    "cat.mobile": "মোবাইল ও ইন্টারনেট",
    "cat.shopping": "কেনাকাটা",
    "cat.entertainment": "বিনোদন",
    "cat.care": "ব্যক্তিগত যত্ন",
    "cat.health": "স্বাস্থ্য",
    "cat.family": "পরিবার",
    "cat.other": "অন্যান্য",
    "cat.allowance": "অতিরিক্ত ভাতা",
    "cat.gift": "উপহার",
    "cat.other_income": "অন্যান্য আয়",
    generalSavings: "সাধারণ সঞ্চয়",
    customCat: "নিজের খাত",
    addCategory: "খাত যোগ",
    catAdded: "খাত যোগ হয়েছে।",
    catName: "নতুন খাতের নাম",
    budgetTitle: "বাজেট",
    budgetSub: "দুটি মোড। বদলালে ইতিহাস মুছে যায় না।",
    smartExplain: "দৈনিক নির্দেশনা হলো বাকি খরচযোগ্য টাকা ভাগ ঢাকার সময় অনুযায়ী মাসের বাকি দিন।",
    fixedExplain: "আপনি একটি দৈনিক সীমা দেন। আজ সেটি পেরোলে সতর্ক করা হয়।",
    startingMoney: "মাসের শুরুর টাকা (৳)",
    savingsTarget: "সঞ্চয়ের লক্ষ্য (৳)",
    fixedReserved: "ধরা স্থির খরচ (৳)",
    emergency: "জরুরি রিজার্ভ (৳)",
    dailyLimit: "দৈনিক সীমা (৳)",
    applyBudget: "বাজেট সেভ",
    reservedNote: "লক্ষ্য ও রিজার্ভ পরিকল্পনা, লেনদেন নয়। আসল খরচ আলাদা লিখুন, নইলে দুবার গোনা হবে।",
    broughtIn: "গত মাস থেকে আনা",
    pocketExplainer: "এটি এই মাসের পকেট মানি। বাড়তি টাকা আয় হিসেবে যোগ করুন।",
    includedCarry: "শুরুর পুলের মধ্যে আছে। নতুন আয়ের রেকর্ড নয়।",
    remainingNow: "এই মাসে বাকি",
    limit: "দৈনিক সীমা",
    spentTodayLabel: "আজ খরচ",
    remainingToday: "আজ বাকি",
    usage: "আজকের সীমার",
    overToday: "আজ দৈনিক সীমা পেরিয়েছে।",
    withinToday: "আজ দৈনিক সীমার মধ্যে আছে।",
    goalsTitle: "সঞ্চয়",
    goalsSub: "ট্রান্সফার খাতার ভেতরে টাকা সরায়। এটা আয় বা খরচ নয়।",
    newGoal: "নতুন লক্ষ্য",
    editGoal: "লক্ষ্য সম্পাদনা",
    goalName: "লক্ষ্যের নাম",
    targetAmount: "টার্গেট (৳)",
    targetDate: "লক্ষ্য তারিখ",
    savedOf: "জমা হয়েছে, মোট",
    toGo: "বাকি",
    deposit: "জমা",
    withdraw: "তোলা",
    noGoals: "এখনো কোনো লক্ষ্য নেই",
    noGoalsHint: "একটি লক্ষ্য বানান, তারপর টাকা সরান।",
    goalPh: "একটি স্মার্টফোন",
    savedAcross: "সব লক্ষ্যে জমা",
    unassigned: "কোনো লক্ষ্যে নয়",
    goalMoves: "চলাচল",
    noMoves: "এখনো জমা নেই।",
    insightsTitle: "বিশ্লেষণ",
    insightsSub: "হিসাব শুধু আপনার লেখা লেনদেন থেকে।",
    notEnough: "স্কোর বা তুলনার জন্য এই মাসে যথেষ্ট লেনদেন নেই।",
    notEnoughHint: "এই মাসে অন্তত তিনটি রেকর্ড দিন। প্রবণতা বানিয়ে বলা হবে না।",
    score: "শৃঙ্খলা স্কোর",
    noSpendDays: "খরচহীন দিন",
    noSpendStreak: "খরচহীন ধারা",
    withinStreak: "সীমার ভেতরের ধারা",
    daysWithin: "গাইডের ভেতরে দিন",
    highestCat: "সবচেয়ে বেশি খরচের খাত",
    avgDaily: "গড় দৈনিক খরচ",
    monthSpend: "এই মাসের খরচ",
    vsLast: "গত মাসের সাথে",
    noCompare: "তুলনা করার মতো গত মাসের খরচ নেই।",
    catMore: "এই মাসে {cat}-এ গত মাসের চেয়ে {pct}% বেশি খরচ হয়েছে।",
    catLess: "এই মাসে {cat}-এ গত মাসের চেয়ে {pct}% কম খরচ হয়েছে।",
    whatIf: "যদি এমন হয়",
    whatIfHint: "এটি আপনার খাতা বদলায় না।",
    extraExpense: "যদি খরচ করি (৳)",
    extraIncome: "যদি পাই (৳)",
    newDaily: "তখন দৈনিক সুপারিশ হবে",
    newRemaining: "তখন বাকি বাজেট হবে",
    byCategory: "খাত অনুযায়ী খরচ",
    dailyChart: "দৈনিক খরচ",
    monthlyChart: "আয় ও খরচ",
    weekly: "এই মাস সপ্তাহে",
    incomeVs: "আয় বনাম খরচ",
    noChart: "চার্টের জন্য রেকর্ড দিন।",
    monthsTitle: "মাসিক ইতিহাস",
    monthsSub: "প্রতি মাসের রেকর্ড আলাদা। পুরনো আয় নতুন আয় হয়ে ঢোকে না।",
    carryAsk: "নতুন মাস শুরু হয়েছে",
    carryBody: "{month} মাসে এখনো {amount} আছে। সেটি {next}-এ আনবেন, না নতুন করে শুরু করবেন?",
    carryYes: "বাকি টাকা আনুন",
    carryNo: "নতুন করে শুরু",
    noSurplus: "{month} মাসে আনার মতো বাড়তি টাকা নেই। {next} নতুন করে শুরু হবে।",
    noSurplusOk: "নতুন করে শুরু",
    alertsTitle: "সতর্কতা",
    alertsEmpty: "এখনো কোনো সতর্কতা নেই।",
    alertsSub: "সতর্কতা তখনই আসে, যখন আপনার রেকর্ড কোনো সীমা পেরোয়।",
    markRead: "সব পড়া হয়েছে",
    enableBrowser: "ব্রাউজার নোটিফিকেশন চালু",
    notifExplain:
      "পেজ খোলা থাকলে বা খোলার পর Pocketly জানাতে পারে। GitHub Pages-এ কোনো ব্যাকগ্রাউন্ড সার্ভার নেই, তাই অ্যাপ পুরো বন্ধ থাকলে ফোনে পিং যাবে না।",
    permGranted: "এই ডিভাইসে ব্রাউজার নোটিফিকেশন চালু।",
    permDenied: "অনুমতি দেওয়া হয়নি। অ্যাপের ভেতরের সতর্কতা চলবে।",
    permNA: "এই ব্রাউজারে এখানে নোটিফিকেশন নেই।",
    dailyReminder: "দৈনিক খরচের রিমাইন্ডার",
    budgetWarning: "বাজেট সীমার সতর্কতা",
    lowBalance: "কম ব্যালেন্সের সতর্কতা",
    monthWarning: "মাস শেষের সতর্কতা",
    savingsUpdates: "সঞ্চয় লক্ষ্যের আপডেট",
    monthlySummary: "মাসিক সারাংশ",
    alertDaily: "আজ কোনো খরচ লেখা হয়নি। খরচ হয়ে থাকলে তবেই যোগ করুন।",
    alertOverMonth: "এই মাসের খরচ খরচযোগ্য বাজেট পেরিয়েছে।",
    alertOverDay: "আজকের খরচ দৈনিক সীমা পেরিয়েছে।",
    alertLow: "ব্যবহারযোগ্য ব্যালেন্স ৳৫০০-এর নিচে।",
    alertMonth: "ঢাকার এই মাসে তিন দিন বা তার কম বাকি।",
    alertGoal: "“{name}” লক্ষ্য পূরণ হয়েছে।",
    alertSummary: "গত মাস: আয় {income}, খরচ {expense}।",
    settingsTitle: "সেটিংস",
    settingsSub: "ভাষা, থিম, পিন, ব্যাকআপ।",
    language: "ভাষা",
    appearance: "চেহারা",
    dark: "ডার্ক",
    light: "লাইট",
    system: "সিস্টেম ডিফল্ট",
    currencyLine: "বাংলাদেশি টাকা (৳) · Asia/Dhaka",
    backup: "ব্যাকআপ",
    backupHint: "JSON-এ সব রেকর্ড থাকে। CSV শুধু লেনদেনের শিট। ফাইল গোপন রাখুন।",
    exportJson: "JSON ব্যাকআপ নামান",
    exportCsv: "CSV নামান",
    importJson: "JSON ব্যাকআপ ফেরান",
    restored: "ব্যাকআপ ফিরে এসেছে।",
    invalidFile: "এটি Pocketly ব্যাকআপ নয়।",
    erase: "এই ডিভাইসের সব ডেটা মুছুন",
    eraseHint: "নিশ্চিত করতে DELETE লিখুন। ফেরত আনা যাবে না।",
    eraseConfirm: "এই ব্রাউজারে Pocketly-এর সব তথ্য মুছবেন?",
    wiped: "সব স্থানীয় ডেটা মুছেছে।",
    typeDelete: "DELETE",
    pin: "অ্যাপ পিন",
    setPin: "পিন সেট করুন",
    changePin: "পিন বদলান",
    removePin: "পিন সরান",
    removePinConfirm: "পিন লক সরাবেন?",
    about: "Pocketly সম্পর্কে",
    aboutBody:
      "Pocketly একটি পকেট-মানি খাতা। এটি বিকাশ, ব্যাংক বা নগদের সাথে যুক্ত নয়। ব্যালেন্স আপনি যা লেখেন তা থেকেই হিসাব হয়। ক্লাউড সাইন-ইন নেই, তাই কোনো বিল্ড ছাড়াই সাইট প্রকাশ করা যায়।",
    security: "নিরাপত্তা",
    securityBody: "পিন লবণসহ হ্যাশ হিসেবে থাকে, সরাসরি সংখ্যা হিসেবে নয়। বায়োমেট্রিক লক নেটিভ অ্যাপে লাগে — এখানে সেই দাবি করা হয়নি।",
    dataStays: "এই ডিভাইসে",
    lock: "লক",
    profile: "প্রোফাইল",
    confirmTitle: "নিশ্চিত করুন",
    yes: "নিশ্চিত",
    no: "বাতিল",
    today: "আজ",
    over: "বেশি",
    left: "বাকি",
    week: "সপ্তাহ",
    total: "মোট",
    optional: "ঐচ্ছিক",
    progress: "অগ্রগতি",
    required: "প্রয়োজন",
    modeSmartShort: "স্মার্ট",
    modeFixedShort: "নির্দিষ্ট",
    guide: "গাইড",
    actual: "আসল",
    plan: "পরিকল্পনা",
    used: "ব্যবহৃত",
    days: "দিন",
    scoreHint: "স্কোরের অর্ধেক গাইডের ভেতরের দিন, ৩০ পয়েন্ট মাসিক পুলের ভেতরে থাকা, ২০ পয়েন্ট সঞ্চয়ের অগ্রগতি।",
    avgHint: "এই মাসে আজসহ যত দিন গেছে, খরচ ভাগ সেই দিন।",
    chartIncome: "আয়",
    chartExpense: "খরচ",
    moreTitle: "আরও",
    moreSub: "বাজেট, বিশ্লেষণ, মাস, সতর্কতা ও সেটিংস।",
    sampleBanner: "এটি নমুনা মাস। নিজের খাতা চাইলে সেটিংস থেকে মুছে ফেলুন।",
    clearSample: "নমুনা মুছে নতুন করে শুরু",
    startOverConfirm: "নমুনা খাতা মুছে খালি শুরু করবেন?",
    noneYet: "—",
    goalDate: "লক্ষ্য",
    percent: "{n}% জমা",
    movements: "এই লক্ষ্যের ইতিহাস",
    transferOut: "জমা",
    transferIn: "তোলা",
    editShort: "এডিট",
    balanceNote: "শুরুর টাকা + আয় − খরচ − সঞ্চয়ে জমা + সঞ্চয় থেকে তোলা।",
    formula: "খরচযোগ্য = শুরুর টাকা + বাড়তি আয় − সঞ্চয় লক্ষ্য − স্থির রিজার্ভ − জরুরি রিজার্ভ। বাকি = খরচযোগ্য − খরচ।",
    fixedUsage: "নির্দিষ্ট দৈনিক বাজেট",
    smartUsage: "স্মার্ট দৈনিক বাজেট",
    noAlertFilter: "Pocketly যে সীমা দেখছে, আপনি তার ভেতরে আছেন।",
    read: "পড়া",
    unread: "নতুন",
    dhaka: "Asia/Dhaka",
    savePrefs: "পছন্দ নিজে থেকেই সেভ হয়।",
    fileReady: "ফাইল ডাউনলোড হচ্ছে।",
    remainingFunds: "বাকি টাকা",
    startMoneyThis: "এই মাসের শুরুর টাকা",
    carryDone: "এই মাসে গত মাসের বাকি টাকা যোগ হয়েছে।",
    freshDone: "এই মাস গত মাসের বাড়তি টাকা ছাড়াই শুরু।",
    openAdd: "কী লিখবেন?",
    source: "উৎস",
    signedLocal: "স্থানীয় খাতা",
    version: "স্ট্যাটিক সংস্করণ",
    install: "ব্রাউজার মেনু থেকে হোম স্ক্রিনে যোগ করলে অ্যাপের মতো খুলবে। ডেটা তখনও এই ডিভাইসে থাকবে।",
    calToday: "আজ",
    overDay: "গাইডের বেশি",
    quietDay: "খরচ নেই",
    legendSpend: "খরচ",
    prevShort: "আগের",
    thisShort: "এই মাস",
    delta: "পরিবর্তন",
    higher: "বেশি",
    lower: "কম",
    same: "প্রায় একই",
    expenseShare: "খরচের অংশ",
    goalRemain: "বাকি",
    created: "লক্ষ্য সেভ হয়েছে।",
    txSaved: "লেনদেন সেভ হয়েছে।",
    welcomeAside: "প্রতিদিনের টাকার জন্য পরিষ্কার হিসাব।",
    previewLabel: "দৈনিক সিদ্ধান্তের জন্য",
    habits: "প্রতি রাত রিসেট নয় — বাকি দিনের বাজেট।",
  },
};

function translate(lang, key, vars) {
  const table = STR[lang] || STR.en;
  let s = table[key] ?? STR.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  }
  return s;
}


const KEY = "pocketly.ledger.v1";
const COLORS = ["#3d8bfd", "#1fbf8f", "#e8a317", "#e36b76", "#7eb6ff", "#8fd8c8"];
const ALERT_SETTING = {
  daily: "dailyReminder",
  monthBudget: "budgetWarning",
  dayBudget: "budgetWarning",
  low: "lowBalance",
  monthEnd: "monthWarning",
  goal: "savings",
  summary: "monthlySummary",
};
const VIEWS = ["dash", "history", "budget", "savings", "insights", "months", "alerts", "settings", "more"];

const ICONS = {
  home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13"/><path d="M4 6h.01M4 12h.01M4 18h.01"/>',
  wallet: '<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="1"/>',
  chart: '<path d="M4 19V5M4 19h16"/><path d="m7 15 3-4 3 2 5-6"/>',
  bell: '<path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  trash: '<path d="M4 7h16M9 7V5h6v2M8 7l1 13h6l1-13"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  lock: '<rect x="6" y="11" width="12" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  back: '<path d="M15 6 9 12l6 6"/>',
  moon: '<path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5z"/>',
  download: '<path d="M12 4v10M7 10l5 5 5-5M5 20h14"/>',
  calendar: '<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M8 3v4M16 3v4M4 10h16"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};

let data = blankState();
let now = dhakaParts();
const ui = {
  view: "dash",
  modal: null,
  confirm: null,
  search: "",
  type: "all",
  cat: "all",
  range: "month",
  sort: "newest",
  from: "",
  to: "",
  toast: "",
  pinEntry: "",
  pinFlow: null,
  pinFirst: "",
  pinError: "",
  editingId: null,
  editingGoal: null,
  budgetFields: null,
  pendingBudget: null,
  txDraft: null,
  txType: "expense",
  whatExpense: "",
  whatIncome: "",
  helpStep: 0,
  installHelp: false,
};

let deferredInstallPrompt = null;
let installPromptBound = false;
function isStandaloneApp() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}
function installButtonHtml() {
  if (isStandaloneApp()) return `<span class="install-state">${ico("check")} ${esc(lang()==="bn"?"ইনস্টল করা আছে":"Installed")}</span>`;
  return `<button class="btn install-btn" type="button" data-action="install">${ico("download")} ${esc(lang()==="bn"?"অ্যাপ ইনস্টল":"Install app")}</button>`;
}
function helpOverlayHtml() {
  if (!ui.installHelp) return "";
  const bn = lang() === "bn";
  const steps = bn ? [
    ["১. শুরু করুন", "প্রথমে আপনার নাম লিখে খাতা শুরু করুন। নিজের আসল হিসাব রাখতে Sample Month ব্যবহার করবেন না।"],
    ["২. আয় যোগ করুন", "নিচের + বোতাম বা Add Income থেকে টাকা আসার তথ্য, পরিমাণ, তারিখ ও ক্যাটাগরি দিন।"],
    ["৩. খরচ লিখুন", "Add Expense চাপুন। প্রতিটি খরচের পরিমাণ ও খাত নির্বাচন করে Save করুন।"],
    ["৪. বাজেট ও সঞ্চয়", "Budget-এ মাসিক টাকা ও লক্ষ্য ঠিক করুন। Savings-এ লক্ষ্য তৈরি করে জমা/উত্তোলন হিসাব রাখুন। History ও Insights-এ পুরোনো হিসাব দেখুন।"]
  ] : [
    ["1. Get started", "Enter your name to create your ledger. Avoid Sample Month if you want to enter your real records."],
    ["2. Add income", "Use the + button or Add Income. Enter the amount, date and category, then save."],
    ["3. Record spending", "Choose Add Expense, enter the amount and category, and save each purchase."],
    ["4. Budget and save", "Set your monthly plan in Budget. Create goals in Savings. Review past records in History and Insights."]
  ];
  const [title,body] = steps[Math.min(ui.helpStep,3)];
  return `<div class="modal-back help-back" data-action="close-help"><section class="modal help-modal" role="dialog" aria-modal="true" data-action="noop"><div class="ph"><span class="eyebrow">${bn?"দ্রুত নির্দেশিকা":"QUICK GUIDE"}</span><button class="btn ghost" type="button" data-action="close-help">${ico("x")}</button></div><div class="help-progress"><i style="width:${(ui.helpStep+1)*25}%"></i></div><h2>${title}</h2><p class="note">${body}</p><div class="help-count">${bn?`ধাপ ${ui.helpStep+1} / ৪`:`Step ${ui.helpStep+1} of 4`}</div><div class="inline"><button class="btn ghost" type="button" data-action="help-prev" ${ui.helpStep===0?"disabled":""}>${bn?"পেছনে":"Back"}</button><button class="btn primary" type="button" data-action="help-next">${ui.helpStep===3?(bn?"শেষ":"Finish"):(bn?"পরের ধাপ":"Next step")}</button></div></section></div>`;
}
function installHelpHtml() {
  const bn = lang() === "bn";
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = isStandaloneApp();
  let body;
  if (standalone) {
    body = bn
      ? "POCKETLY ইতিমধ্যে standalone মোডে চলছে। হোম স্ক্রিনের আইকন থেকে খুললে এটি অ্যাপের মতো কাজ করে।"
      : "POCKETLY is already running in standalone mode. Opening from the home-screen icon keeps it app-like.";
  } else if (isIOS) {
    body = bn
      ? "iPhone/iPad-এ: Safari-এ এই পেজ খুলুন → নিচের Share (□↑) চাপুন → “Add to Home Screen” বেছে নিন। হোম স্ক্রিনের আইকন থেকে খুললে এটি standalone অ্যাপের মতো চলবে। iOS-এ Android-স্টাইল ইনস্টল প্রম্পট নেই।"
      : "On iPhone/iPad: open this page in Safari → tap Share (□↑) → choose “Add to Home Screen”. Launching from that icon opens POCKETLY in standalone mode. iOS does not support the Android-style install prompt.";
  } else if (deferredInstallPrompt) {
    body = bn
      ? "আপনার ব্রাউজার ইনস্টল সাপোর্ট করে। নিচের বাটন চাপলে নেটিভ ইনস্টল প্রম্পট আসবে। ইনস্টলের পর অ্যাপটি standalone মোডে খুলবে।"
      : "Your browser supports installation. Tap the button below to show the native install prompt. After install, POCKETLY opens in standalone mode.";
  } else {
    body = bn
      ? "Chrome বা Edge-এ মেনু → “Install app” বা “Add to Home screen” দেখুন। কিছু ব্রাউজার বা HTTP সাইটে ইনস্টল অফার নাও করতে পারে। HTTPS + valid manifest প্রয়োজন।"
      : "In Chrome or Edge, open the browser menu and look for “Install app” or “Add to Home screen”. Some browsers or non-HTTPS hosts will not offer install. A valid HTTPS origin and manifest are required.";
  }
  const tryBtn = (!standalone && !isIOS && deferredInstallPrompt)
    ? `<button class="btn primary block" type="button" data-action="try-install">${bn ? "এখন ইনস্টল করুন" : "Install now"}</button>`
    : (!standalone && isIOS)
      ? `<div class="banner">${bn ? "Safari Share → Add to Home Screen ব্যবহার করুন।" : "Use Safari Share → Add to Home Screen."}</div>`
      : `<button class="btn primary block" type="button" data-action="try-install">${bn ? "ইনস্টল চেষ্টা করুন" : "Try install"}</button>`;
  return `<div class="modal-back" data-action="close-install"><section class="modal" role="dialog" aria-modal="true" data-action="noop"><div class="ph"><h2>${bn ? "POCKETLY ইনস্টল" : "Install POCKETLY"}</h2><button class="btn ghost" type="button" data-action="close-install">${ico("x")}</button></div><p class="note">${body}</p><div class="banner">${bn ? "ইনস্টলের পর অ্যাপটি আলাদা উইন্ডোতে খুলবে। আপনার হিসাব এই ডিভাইসের ব্রাউজারেই থাকবে — কোনো সার্ভারে পাঠানো হয় না।" : "After installation POCKETLY opens in its own window. Your ledger stays on this device — nothing is sent to a server."}</div>${tryBtn}</section></div>`;
}
function bindInstallPrompt() {
  if (installPromptBound) return;
  installPromptBound = true;
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); deferredInstallPrompt = event; render(); });
  window.addEventListener("appinstalled", () => { deferredInstallPrompt = null; toast(lang()==="bn"?"POCKETLY ইনস্টল হয়েছে":"POCKETLY installed"); render(); });
}

function ico(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => {
    if (c === "&") return "&" + "amp;";
    if (c === "<") return "&" + "lt;";
    if (c === ">") return "&" + "gt;";
    if (c === '"') return "&" + "quot;";
    return "&" + "#39;";
  });
}
function lang() { return data.settings?.language === "bn" ? "bn" : "en"; }
function t(key, vars) { return translate(lang(), key, vars); }
function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function money(poisha) {
  const n = Number(poisha) || 0;
  const formatted = new Intl.NumberFormat(lang() === "bn" ? "bn-BD" : "en-BD", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(n) / 100);
  return `${n < 0 ? "−" : ""}৳${formatted}`;
}
function takaStr(poisha) { return ((Number(poisha) || 0) / 100).toFixed(2); }
function catLabel(id) {
  if (!id || id === "savings") return t("savings");
  if (String(id).startsWith("custom:")) return String(id).slice(7);
  const key = `cat.${id}`;
  const label = t(key);
  return label === key ? String(id) : label;
}
function payLabel(id) { return id === "other" ? t("otherPay") : t(id); }
function formatDay(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Intl.DateTimeFormat(lang() === "bn" ? "bn-BD" : "en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
function formatMonth(key) {
  const [y, m] = key.split("-").map(Number);
  return new Intl.DateTimeFormat(lang() === "bn" ? "bn-BD" : "en-GB", {
    month: "long", year: "numeric", timeZone: "UTC",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}
function dayLabel(dateStr) {
  if (dateStr === now.date) return t("today");
  return formatDay(dateStr);
}
function txTitle(tx) {
  if (tx.description) return tx.description;
  if (tx.type === "savings") {
    const goal = data.goals.find((g) => g.id === tx.goalId);
    return goal ? goal.name : t("generalSavings");
  }
  return catLabel(tx.category);
}
function formType(tx) {
  if (tx.type === "savings") return tx.direction === "in" ? "savings-in" : "savings-out";
  return tx.type;
}
function currentMonth() {
  return data.months[now.key] || { startingMoney: data.budget.monthlyStartingMoney || 0, carryIn: 0, rollover: "fresh" };
}
function summary() {
  return calculateBudget({ transactions: data.transactions, budget: data.budget, monthRecord: currentMonth(), parts: now });
}
function unlocked() {
  if (!data.profile?.pin) return true;
  try { return sessionStorage.getItem("pocketly.unlocked") === "1"; } catch { return false; }
}
function unread() { return data.notificationLog.filter((n) => !n.read).length; }
function resolvedTheme() {
  if (data.settings.theme === "light") return "light";
  if (data.settings.theme === "dark") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyTheme() {
  const theme = resolvedTheme();
  document.documentElement.dataset.theme = theme;
  document.documentElement.lang = lang() === "bn" ? "bn" : "en";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", theme === "light" ? "#f3f6fb" : "#0c1730");
  return theme;
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(data));
}
function load() {
  try { data = normalize(JSON.parse(localStorage.getItem(KEY) || "null")); }
  catch { data = blankState(); }
  try {
    const view = sessionStorage.getItem("pocketly.view");
    if (VIEWS.includes(view)) ui.view = view;
  } catch { /* ignore */ }
}
function toast(text) {
  ui.toast = text;
  render();
  setTimeout(() => {
    ui.toast = "";
    document.getElementById("toast")?.remove();
  }, 2600);
}
function go(view) {
  ui.view = view;
  if (view !== "budget") ui.budgetFields = null;
  ui.modal = null;
  ui.txDraft = null;
  try { sessionStorage.setItem("pocketly.view", view); } catch { /* ignore */ }
  render();
}
function ensureMonth() {
  if (!data.profile) return;
  if (!data.months[now.key]) {
    const prevKey = previousMonthKey(now.key);
    const hasHistory = Boolean(data.months[prevKey]) || data.transactions.some((tx) => String(tx.occurredAt).slice(0, 7) === prevKey);
    data.months[now.key] = {
      startingMoney: data.budget.monthlyStartingMoney || 0,
      carryIn: 0,
      rollover: hasHistory ? "ask" : "fresh",
    };
    save();
  }
}
async function hashPin(pin, salt) {
  const bytes = new TextEncoder().encode(`${salt}:${pin}`);
  if (crypto.subtle) {
    const buf = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let h = 2166136261;
  const str = `${salt}:${pin}`;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `fnv:${(h >>> 0).toString(16)}`;
}
function maybeNotify(body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try { new Notification("POCKETLY", { body }); } catch { /* permission or gesture */ }
}
function syncAlerts() {
  if (!data.profile) return;
  const parts = dhakaParts();
  const month = data.months[parts.key] || { startingMoney: 0, carryIn: 0 };
  const snap = calculateBudget({ transactions: data.transactions, budget: data.budget, monthRecord: month, parts });
  const toggles = data.settings.notifications;
  let changed = false;
  const add = (id, type, body) => {
    const setting = ALERT_SETTING[type];
    if (setting && toggles[setting] === false) return;
    if (data.notificationLog.some((n) => n.id === id)) return;
    data.notificationLog.unshift({ id, type, body, at: parts.stamp, read: false });
    changed = true;
    maybeNotify(body);
  };
  if (parts.hour >= 18 && snap.spentToday === 0 && data.transactions.length > 0) {
    add(`daily:${parts.date}`, "daily", t("alertDaily"));
  }
  if (snap.remaining < 0 && snap.expenses > 0) add(`over:${parts.key}`, "monthBudget", t("alertOverMonth"));
  if (snap.spentToday > snap.todayGuide && snap.spentToday > 0) add(`day:${parts.date}`, "dayBudget", t("alertOverDay"));
  if (data.transactions.length > 0 && snap.available < 50000) add(`low:${parts.date}`, "low", t("alertLow"));
  if (snap.daysLeft <= 3 && (snap.starting > 0 || snap.monthTx.length > 0)) add(`monthend:${parts.key}`, "monthEnd", t("alertMonth"));
  for (const goal of data.goals) {
    if (goal.targetAmount > 0 && goalBalance(data.transactions, goal.id) >= goal.targetAmount) {
      add(`goal:${goal.id}`, "goal", t("alertGoal", { name: goal.name }));
    }
  }
  if (parts.day <= 2) {
    const prev = previousMonthKey(parts.key);
    const prevTx = data.transactions.filter((tx) => String(tx.occurredAt).slice(0, 7) === prev);
    if (prevTx.some((tx) => tx.type === "income" || tx.type === "expense")) {
      const income = prevTx.filter((tx) => tx.type === "income").reduce((s, tx) => s + tx.amount, 0);
      const expense = prevTx.filter((tx) => tx.type === "expense").reduce((s, tx) => s + tx.amount, 0);
      add(`summary:${prev}`, "summary", t("alertSummary", { income: money(income), expense: money(expense) }));
    }
  }
  if (changed) {
    data.notificationLog = data.notificationLog.slice(0, 50);
    save();
  }
}
function makeTx(partial) {
  return {
    id: uid(),
    notes: "",
    paymentMethod: "cash",
    description: "",
    goalId: "",
    direction: partial.type === "income" ? "in" : "out",
    createdAt: Date.now(),
    ...partial,
  };
}
function fillSample(name, language) {
  const parts = dhakaParts();
  const prev = previousMonthKey(parts.key);
  const phone = uid();
  const stamp = (day, time) => {
    const d = Math.min(Math.max(1, day), Math.max(1, parts.day));
    return `${parts.key}-${String(d).padStart(2, "0")}T${time}`;
  };
  data = blankState();
  data.sample = true;
  data.profile = { name, createdAt: Date.now(), pin: null };
  data.settings.language = language;
  data.budget = {
    mode: "smart",
    monthlyStartingMoney: 600000,
    savingsTarget: 50000,
    fixedExpenses: 100000,
    emergencyReserve: 20000,
    dailyLimit: 15000,
  };
  data.months = {
    [prev]: { startingMoney: 600000, carryIn: 0, rollover: "fresh" },
    [parts.key]: { startingMoney: 600000, carryIn: 0, rollover: "fresh" },
  };
  data.goals = [{ id: phone, name: lang() === "bn" ? "স্মার্টফোন" : "Smartphone", targetAmount: 2000000, targetDate: "", createdAt: Date.now() }];
  data.transactions = [
    makeTx({ type: "expense", category: "food", amount: 60000, occurredAt: `${prev}-04T13:10`, description: lang() === "bn" ? "দুপুরের খাবার" : "Lunch" }),
    makeTx({ type: "expense", category: "food", amount: 70000, occurredAt: `${prev}-11T20:00`, description: lang() === "bn" ? "রাতের খাবার" : "Dinner" }),
    makeTx({ type: "expense", category: "food", amount: 50000, occurredAt: `${prev}-18T09:30`, description: lang() === "bn" ? "নাস্তা" : "Breakfast" }),
    makeTx({ type: "expense", category: "food", amount: 54000, occurredAt: stamp(2, "13:20"), description: lang() === "bn" ? "ক্যান্টিন" : "Canteen" }),
    makeTx({ type: "expense", category: "transport", amount: 40000, occurredAt: stamp(4, "08:10"), paymentMethod: "bkash", description: lang() === "bn" ? "বাসে" : "Bus fare" }),
    makeTx({ type: "income", category: "allowance", amount: 100000, occurredAt: stamp(5, "18:00"), direction: "in", description: lang() === "bn" ? "বাড়তি ভাতা" : "Extra allowance" }),
    makeTx({ type: "expense", category: "food", amount: 70000, occurredAt: stamp(6, "21:00"), description: lang() === "bn" ? "বন্ধুদের সাথে" : "Dinner out" }),
    makeTx({ type: "savings", category: "savings", amount: 30000, occurredAt: stamp(7, "19:00"), direction: "out", goalId: phone, description: lang() === "bn" ? "ফোনের জমা" : "Phone fund" }),
    makeTx({ type: "expense", category: "education", amount: 80000, occurredAt: stamp(8, "11:00"), paymentMethod: "cash", description: lang() === "bn" ? "নোটের ফটোকপি" : "Notes and copies" }),
    makeTx({ type: "expense", category: "food", amount: 42000, occurredAt: stamp(9, "16:40") }),
    makeTx({ type: "income", category: "gift", amount: 50000, occurredAt: stamp(11, "12:00"), direction: "in", paymentMethod: "nagad", description: lang() === "bn" ? "উপহার" : "Gift" }),
    makeTx({ type: "expense", category: "mobile", amount: 30000, occurredAt: stamp(12, "20:15"), paymentMethod: "bkash", description: lang() === "bn" ? "ইন্টারনেট" : "Mobile data" }),
    makeTx({ type: "expense", category: "food", amount: 50000, occurredAt: stamp(14, "14:05") }),
    makeTx({ type: "expense", category: "shopping", amount: 60000, occurredAt: stamp(16, "17:45"), paymentMethod: "card", description: lang() === "bn" ? "ছোট কেনাকাটা" : "Small shopping" }),
  ];
}
function startLedger(name, sample) {
  const language = lang();
  if (sample) fillSample(name, language);
  else {
    data = blankState();
    data.profile = { name, createdAt: Date.now(), pin: null };
    data.settings.language = language;
    now = dhakaParts();
    ensureMonth();
  }
  now = dhakaParts();
  save();
  syncAlerts();
  ui.view = "dash";
  render();
}
function download(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  toast(t("fileReady"));
}
function exportJson() {
  download(`pocketly-backup-${now.date}.json`, JSON.stringify({ app: "POCKETLY", version: 1, exportedAt: new Date().toISOString(), data }, null, 2), "application/json");
}
function exportCsv() {
  const header = ["Date", "Time", "Type", "Category", "Amount_BDT", "Description", "Notes", "Payment", "Goal"];
  const lines = data.transactions.map((tx) => {
    const goal = data.goals.find((g) => g.id === tx.goalId);
    const cols = [
      tx.occurredAt.slice(0, 10), tx.occurredAt.slice(11, 16), tx.type, catLabel(tx.category),
      (tx.amount / 100).toFixed(2), tx.description || "", tx.notes || "", payLabel(tx.paymentMethod), goal?.name || "",
    ];
    return cols.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",");
  });
  download(`pocketly-${now.date}.csv`, [header.join(","), ...lines].join("\n"), "text/csv");
}
async function importJson(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const payload = parsed?.data && typeof parsed.data === "object" ? parsed.data : parsed;
    if (!payload || !Array.isArray(payload.transactions)) throw new Error("bad");
    data = normalize(payload);
    now = dhakaParts();
    ensureMonth();
    save();
    try { sessionStorage.removeItem("pocketly.unlocked"); } catch { /* ignore */ }
    syncAlerts();
    toast(t("restored"));
  } catch {
    toast(t("invalidFile"));
  }
}
function inRange(tx) {
  const day = String(tx.occurredAt).slice(0, 10);
  if (ui.range === "month") return day.slice(0, 7) === now.key;
  if (ui.range === "last") return day.slice(0, 7) === previousMonthKey(now.key);
  if (ui.range === "custom") {
    if (ui.from && day < ui.from) return false;
    if (ui.to && day > ui.to) return false;
  }
  return true;
}
function filteredTx() {
  const q = ui.search.trim().toLowerCase();
  const list = data.transactions.filter((tx) => {
    if (ui.type !== "all" && tx.type !== ui.type) return false;
    if (ui.cat !== "all" && tx.category !== ui.cat) return false;
    if (!inRange(tx)) return false;
    if (!q) return true;
    const blob = `${tx.description} ${tx.notes} ${catLabel(tx.category)} ${payLabel(tx.paymentMethod)} ${txTitle(tx)}`.toLowerCase();
    return blob.includes(q);
  });
  list.sort((a, b) => {
    if (ui.sort === "high") return b.amount - a.amount;
    if (ui.sort === "low") return a.amount - b.amount;
    if (ui.sort === "oldest") return a.occurredAt.localeCompare(b.occurredAt);
    return b.occurredAt.localeCompare(a.occurredAt);
  });
  return list;
}
function amountHtml(tx) {
  if (tx.type === "income" || (tx.type === "savings" && tx.direction === "in")) return `<b class="amt pos">+${esc(money(tx.amount))}</b>`;
  if (tx.type === "savings") return `<b class="amt save">↗ ${esc(money(tx.amount))}</b>`;
  return `<b class="amt neg">−${esc(money(tx.amount))}</b>`;
}
function txRow(tx, actions) {
  const bubble = tx.type === "income" ? "green" : tx.type === "savings" ? "blue" : "red";
  const icon = tx.type === "income" ? "down" : tx.type === "savings" ? "target" : "up";
  return `<article class="tx">
    <span class="bubble ${bubble}">${ico(icon)}</span>
    <div><b>${esc(txTitle(tx))}</b><small>${esc(catLabel(tx.category))} · ${esc(payLabel(tx.paymentMethod))} · ${esc(dayLabel(tx.occurredAt.slice(0, 10)))} ${esc(tx.occurredAt.slice(11, 16))}</small></div>
    ${amountHtml(tx)}
    ${actions ? `<div class="row-actions"><button class="btn ghost" type="button" data-action="edit-tx" data-id="${esc(tx.id)}">${esc(t("edit"))}</button><button class="btn danger" type="button" data-action="delete-tx" data-id="${esc(tx.id)}">${esc(t("delete"))}</button></div>` : ""}
  </article>`;
}
function empty(title, hint) {
  return `<div class="empty"><strong>${esc(title)}</strong><span>${esc(hint)}</span></div>`;
}
function progress(value, hot) {
  const width = Math.max(0, Math.min(100, value));
  return `<div class="progress" aria-hidden="true"><i class="${hot ? "hot" : ""}" style="width:${width}%"></i></div>`;
}
function navBtn(view, icon, label) {
  const badge = view === "alerts" && unread() ? `<span class="badge">${unread()}</span>` : "";
  return `<button class="nav-btn ${ui.view === view ? "active" : ""}" type="button" data-action="nav" data-view="${view}">${ico(icon)}<span>${esc(label)}</span>${badge}</button>`;
}
function shell(body) {
  const name = data.profile?.name || "";
  const activeMore = ["budget", "insights", "months", "alerts", "settings", "more"].includes(ui.view);
  return `<div class="app">
    <aside class="sidebar">
      <div class="brand"><div class="mark">P</div><div><b>POCKETLY</b><small>${esc(t("tagline"))}</small></div></div>
      <nav class="nav">
        ${navBtn("dash", "home", t("navDash"))}
        ${navBtn("history", "list", t("navHistory"))}
        ${navBtn("budget", "wallet", t("navBudget"))}
        ${navBtn("savings", "target", t("navSavings"))}
        ${navBtn("insights", "chart", t("navInsights"))}
        ${navBtn("months", "calendar", t("navMonths"))}
        ${navBtn("alerts", "bell", t("navAlerts"))}
        ${navBtn("settings", "gear", t("navSettings"))}
      </nav>
      <div class="side-foot">
        <div class="side-note">${esc(t("dataStays"))}<br><b>${esc(t("currencyLine"))}</b></div>
        <button class="who" type="button" data-action="nav" data-view="settings"><span class="avatar">${esc(name.slice(0, 1).toUpperCase())}</span><span><b>${esc(name)}</b><small>${esc(t("signedLocal"))}</small></span></button>
      </div>
    </aside>
    <div class="main">
      ${data.sample ? `<div class="banner">${esc(t("sampleBanner"))}</div>` : ""}
      <header class="top"><div><div class="eyebrow">${esc(t("kicker"))}</div><h1>${esc(titleFor(ui.view))}</h1></div>
        <div class="top-actions"><button class="btn ghost help-btn" type="button" data-action="help">${ico("list")} ${esc(lang()==="bn"?"কীভাবে ব্যবহার করবেন":"How to use")}</button>${installButtonHtml()}${data.profile?.pin ? `<button class="btn ghost" type="button" data-action="lock">${ico("lock")} ${esc(t("lock"))}</button>` : ""}</div>
      </header>
      <div class="content">${body}</div>
    </div>
    <nav class="tabbar">
      <button class="tab ${ui.view === "dash" ? "on" : ""}" type="button" data-action="nav" data-view="dash">${ico("home")}<span>${esc(t("navDash"))}</span></button>
      <button class="tab ${ui.view === "history" ? "on" : ""}" type="button" data-action="nav" data-view="history">${ico("list")}<span>${esc(t("navHistory"))}</span></button>
      <button class="tab add" type="button" data-action="open-add"><span class="fab">${ico("plus")}</span><span>${esc(t("add"))}</span></button>
      <button class="tab ${ui.view === "savings" ? "on" : ""}" type="button" data-action="nav" data-view="savings">${ico("target")}<span>${esc(t("navSavings"))}</span></button>
      <button class="tab ${activeMore ? "on" : ""}" type="button" data-action="nav" data-view="more">${ico("gear")}<span>${esc(t("navMore"))}</span>${unread() ? `<span class="badge">${unread()}</span>` : ""}</button>
    </nav>
    ${overlay()}
    ${helpOverlayHtml()}${ui.modal === "install-help" ? installHelpHtml() : ""}
  </div>${ui.toast ? `<div id="toast" class="toast" role="status">${esc(ui.toast)}</div>` : ""}`;
}
function titleFor(view) {
  return {
    dash: t("navDash"), history: t("historyTitle"), budget: t("budgetTitle"), savings: t("goalsTitle"),
    insights: t("insightsTitle"), months: t("monthsTitle"), alerts: t("alertsTitle"), settings: t("settingsTitle"), more: t("moreTitle"),
  }[view] || t("appName");
}
function viewDash() {
  const s = summary();
  const used = s.spendable > 0 ? Math.min(100, (s.expenses / s.spendable) * 100) : (s.expenses > 0 ? 100 : 0);
  const recent = data.transactions.slice().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 5);
  const saved = totalGoalSavings(data.transactions, data.goals);
  const overToday = s.spentToday > s.todayGuide && s.spentToday > 0;
  return `<section class="hero">
      <div>
        <div class="eyebrow">${esc(t("available"))}</div>
        <div class="amount">${esc(money(s.available))}</div>
        <p class="hint">${esc(t("balanceNote"))}</p>
      </div>
      <div class="today-pair">
        <div>
          <span class="eyebrow">${esc(t("todayRecommend"))}</span>
          <strong>${esc(money(s.todayGuide))}</strong>
          <span class="hint">${esc(data.budget.mode === "fixed" ? t("fixedUsage") : t("smartUsage"))}</span>
        </div>
        <div>
          <span class="eyebrow">${esc(t("todayActual"))}</span>
          <strong style="${overToday ? "color:var(--red)" : ""}">${esc(money(s.spentToday))}</strong>
          <span class="hint">${overToday ? esc(t("overToday")) : esc(t("withinToday"))}</span>
        </div>
      </div>
    </section>
    <section class="metrics">
      ${metric(t("totalIncome"), money(s.income))}
      ${metric(t("totalExpenses"), money(s.expenses))}
      ${metric(t("remainingBudget"), money(s.remaining))}
      ${metric(t("savingsBalance"), money(saved))}
    </section>
    <section class="panel">
      <div class="ph"><h2>${esc(t("budgetProgress"))}</h2><button class="link" type="button" data-action="nav" data-view="budget">${esc(t("viewAll"))}</button></div>
      <div class="split"><b>${used.toFixed(0)}%</b><span>${esc(t("ofSpendable"))}</span></div>
      ${progress(used, used >= 100)}
      <div class="split"><span>${esc(t("spent"))} <b>${esc(money(s.expenses))}</b></span><span>${esc(t("plan"))} <b>${esc(money(Math.max(0, s.spendable)))}</b></span></div>
      <p class="note">${esc(data.budget.mode === "fixed" ? t("fixedHint") : t("adapts"))}</p>
    </section>
    <section class="grid-2">
      <div class="panel"><div class="ph"><h2>${esc(t("recent"))}</h2><button class="link" type="button" data-action="nav" data-view="history">${esc(t("viewAll"))}</button></div>
        ${recent.length ? recent.map((tx) => txRow(tx, false)).join("") : empty(t("noTx"), t("noTxHint"))}
      </div>
      <div class="panel"><h2>${esc(t("quick"))}</h2>
        ${quick("expense", "up", "red", t("addExpense"))}
        ${quick("income", "down", "green", t("addIncome"))}
        ${quick("savings-out", "target", "blue", t("toSavings"))}
      </div>
    </section>`;
}
function metric(label, value) {
  return `<article class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong></article>`;
}
function quick(type, icon, tone, label) {
  return `<button class="quick" type="button" data-action="open-tx" data-type="${type}"><span class="bubble ${tone}">${ico(icon)}</span><span><b>${esc(label)}</b><small>${esc(t("openAdd"))}</small></span></button>`;
}
function historyListHtml() {
  const list = filteredTx();
  if (!list.length) return empty(t("emptyFilter"), t("noTxHint"));
  if (ui.sort === "high" || ui.sort === "low") return list.map((tx) => txRow(tx, true)).join("");
  let html = "";
  let last = "";
  for (const tx of list) {
    const day = tx.occurredAt.slice(0, 10);
    if (day !== last) { html += `<div class="day-label">${esc(dayLabel(day))}</div>`; last = day; }
    html += txRow(tx, true);
  }
  return html;
}
function viewHistory() {
  const cats = [...new Set(data.transactions.map((tx) => tx.category))].filter((id) => id && id !== "savings");
  return `<div class="toolbar">
      <label class="search">${ico("list")}<input id="search" data-bind="search" value="${esc(ui.search)}" placeholder="${esc(t("search"))}" autocomplete="off"></label>
      <select data-bind="type" aria-label="${esc(t("type"))}">${opt("all", t("allTypes"), ui.type)}${opt("expense", t("expense"), ui.type)}${opt("income", t("income"), ui.type)}${opt("savings", t("savings"), ui.type)}</select>
      <select data-bind="range" aria-label="${esc(t("date"))}">${opt("month", t("thisMonth"), ui.range)}${opt("last", t("lastMonth"), ui.range)}${opt("all", t("allTime"), ui.range)}${opt("custom", t("custom"), ui.range)}</select>
      <select data-bind="sort" aria-label="${esc(t("sort") || "sort")}">${opt("newest", t("newest"), ui.sort)}${opt("oldest", t("oldest"), ui.sort)}${opt("high", t("high"), ui.sort)}${opt("low", t("low"), ui.sort)}</select>
    </div>
    <div class="toolbar">
      <select data-bind="cat" aria-label="${esc(t("category"))}"><option value="all">${esc(t("category"))}</option>${cats.map((id) => `<option value="${esc(id)}" ${ui.cat === id ? "selected" : ""}>${esc(catLabel(id))}</option>`).join("")}</select>
      ${ui.range === "custom" ? `<label class="field">${esc(t("from"))}<input data-bind="from" type="date" value="${esc(ui.from)}"></label><label class="field">${esc(t("to"))}<input data-bind="to" type="date" value="${esc(ui.to)}"></label>` : ""}
    </div>
    <section class="panel" id="history-list">${historyListHtml()}</section>`;
}
function opt(value, label, current) {
  return `<option value="${esc(value)}" ${value === current ? "selected" : ""}>${esc(label)}</option>`;
}
function budgetPreviewInner(fields) {
  const budget = { ...data.budget, ...fields };
  const monthRecord = { ...currentMonth(), startingMoney: fields.monthlyStartingMoney };
  const s = calculateBudget({ transactions: data.transactions, budget, monthRecord, parts: now });
  const dayPct = s.dailyLimit > 0 ? Math.min(100, (s.spentToday / s.dailyLimit) * 100) : 0;
  return `<div class="split"><span>${esc(t("remainingNow"))}</span><b class="${s.remaining < 0 ? "neg" : ""}">${esc(money(s.remaining))}</b></div>
    <p class="note">${esc(t("formula"))}</p>
    ${budget.mode === "fixed" ? `<div class="split"><span>${esc(t("usage"))}</span><b>${dayPct.toFixed(0)}%</b></div>${progress(dayPct, s.spentToday > s.dailyLimit)}<p class="${s.spentToday > s.dailyLimit ? "warn" : "good"}">${esc(s.spentToday > s.dailyLimit ? t("overToday") : t("withinToday"))}</p>` : `<p class="note">${esc(t("adapts"))} ${esc(t("todayRecommend"))}: <b>${esc(money(s.recommendedDaily))}</b></p>`}`;
}
function viewBudget() {
  const mode = (ui.budgetFields || data.budget).mode;
  const src = ui.budgetFields || data.budget;
  const fields = {
    mode,
    monthlyStartingMoney: src.monthlyStartingMoney,
    savingsTarget: src.savingsTarget,
    fixedExpenses: src.fixedExpenses,
    emergencyReserve: src.emergencyReserve,
    dailyLimit: src.dailyLimit,
  };
  return `<p class="note">${esc(t("budgetSub"))}</p>
    <form id="budget-form" data-form="budget" class="panel">
      <div class="seg">
        <button type="button" data-action="mode" data-mode="smart" class="${mode === "smart" ? "on" : ""}"><b>${esc(t("smartMode"))}</b><small>${esc(t("smartExplain"))}</small></button>
        <button type="button" data-action="mode" data-mode="fixed" class="${mode === "fixed" ? "on" : ""}"><b>${esc(t("fixedMode"))}</b><small>${esc(t("fixedExplain"))}</small></button>
      </div>
      ${mode === "smart" ? `<div class="fields two">
        ${numField("starting", t("startingMoney"), takaStr(src.monthlyStartingMoney))}
        ${numField("savingsTarget", t("savingsTarget"), takaStr(src.savingsTarget))}
        ${numField("fixed", t("fixedReserved"), takaStr(src.fixedExpenses))}
        ${numField("emergency", t("emergency"), takaStr(src.emergencyReserve))}
      </div><p class="note">${esc(t("pocketExplainer"))} ${esc(t("reservedNote"))}</p><p class="note">${esc(t("broughtIn"))}: <b>${esc(money(currentMonth().carryIn || 0))}</b>. ${esc(t("includedCarry"))}</p>` : numField("daily", t("dailyLimit"), takaStr(src.dailyLimit))}
      <div id="budget-preview">${budgetPreviewInner(fields)}</div>
      <button class="btn primary" type="submit">${esc(t("applyBudget"))}</button>
    </form>
    <section class="panel"><h2>${esc(t("dailyChart"))}</h2>${calendarHtml()}</section>`;
}
function numField(name, label, value) {
  return `<label class="field">${esc(label)}<input name="${esc(name)}" data-bind="budget-field" inputmode="decimal" value="${esc(value)}" autocomplete="off"></label>`;
}
function calendarHtml() {
  const s = summary();
  const guide = data.budget.mode === "fixed" ? s.dailyLimit : (s.daysInMonth ? Math.max(0, s.spendable) / s.daysInMonth : 0);
  const spend = daySpendMap(data.transactions, now.key);
  let html = "";
  for (let d = 1; d <= s.daysInMonth; d++) {
    const stamp = `${now.key}-${String(d).padStart(2, "0")}`;
    const amount = spend[stamp] || 0;
    const cls = ["cell"];
    if (d === now.day) cls.push("today");
    if (d <= now.day && amount === 0) cls.push("quiet");
    if (d <= now.day && amount > guide + 0.5) cls.push("over");
    else if (amount > 0) cls.push("spend");
    html += `<i class="${cls.join(" ")}" title="${esc(money(amount))}">${d}</i>`;
  }
  return `<div class="cal">${html}</div><div class="split"><span>${esc(t("quietDay"))}</span><span>${esc(t("overDay"))}</span></div>`;
}
function viewSavings() {
  const saved = totalGoalSavings(data.transactions, data.goals);
  const cards = data.goals.map((goal) => {
    const bal = goalBalance(data.transactions, goal.id);
    const pct = goal.targetAmount > 0 ? Math.max(0, Math.min(100, (bal / goal.targetAmount) * 100)) : 0;
    const moves = data.transactions.filter((tx) => tx.type === "savings" && tx.goalId === goal.id).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt)).slice(0, 4);
    return `<article class="panel">
      <div class="goal-top"><div><div class="eyebrow">${esc(t("progress"))}</div><h2>${esc(goal.name)}</h2></div>
        <button class="btn ghost" type="button" data-action="edit-goal" data-id="${esc(goal.id)}">${esc(t("edit"))}</button></div>
      <div class="split"><b>${esc(money(bal))}</b><span>${esc(t("savedOf"))} ${esc(money(goal.targetAmount))}</span></div>
      ${progress(pct, false)}
      <div class="split"><span>${esc(t("percent", { n: pct.toFixed(0) }))}</span><b>${esc(money(Math.max(0, goal.targetAmount - bal)))} ${esc(t("toGo"))}</b></div>
      ${goal.targetDate ? `<p class="note">${esc(t("goalDate"))}: ${esc(goal.targetDate)}</p>` : ""}
      <div class="inline">
        <button class="btn primary" type="button" data-action="open-tx" data-type="savings-out" data-goal="${esc(goal.id)}">${esc(t("deposit"))}</button>
        <button class="btn ghost" type="button" data-action="open-tx" data-type="savings-in" data-goal="${esc(goal.id)}">${esc(t("withdraw"))}</button>
        <button class="btn danger" type="button" data-action="delete-goal" data-id="${esc(goal.id)}">${esc(t("delete"))}</button>
      </div>
      <div>${moves.length ? moves.map((tx) => txRow(tx, false)).join("") : `<p class="note">${esc(t("noMoves"))}</p>`}</div>
    </article>`;
  }).join("");
  return `<section class="hero"><div class="eyebrow">${esc(t("savedAcross"))}</div><div class="amount">${esc(money(saved))}</div><p class="hint">${esc(t("goalsSub"))}</p></section>
    <div class="ph"><h2>${esc(t("goalsTitle"))}</h2><button class="btn primary" type="button" data-action="open-goal">${ico("plus")} ${esc(t("newGoal"))}</button></div>
    <article class="panel"><h3>${esc(t("unassigned"))}</h3><strong class="amount" style="font-size:28px">${esc(money(unassignedSavings(data.transactions)))}</strong><p class="note">${esc(t("goalsSub"))}</p></article>
    ${cards || `<section class="panel">${empty(t("noGoals"), t("noGoalsHint"))}</section>`}`;
}
function viewInsights() {
  const s = summary();
  const disc = discipline(data.transactions, data.budget, currentMonth(), now);
  const insight = bestCategoryInsight(data.transactions, now);
  const cats = EXPENSE_CATS.map((id) => ({
    label: catLabel(id),
    value: s.monthTx.filter((tx) => tx.type === "expense" && tx.category === id).reduce((sum, tx) => sum + tx.amount, 0),
  })).filter((row) => row.value > 0);
  for (const custom of data.categories.filter((c) => c.kind === "expense")) {
    const value = s.monthTx.filter((tx) => tx.type === "expense" && tx.category === custom.id).reduce((sum, tx) => sum + tx.amount, 0);
    if (value > 0) cats.push({ label: custom.name, value });
  }
  const highest = cats.slice().sort((a, b) => b.value - a.value)[0];
  const elapsed = Math.max(1, now.day);
  const prevKey = previousMonthKey(now.key);
  const prevExpense = data.transactions.filter((tx) => tx.type === "expense" && String(tx.occurredAt).slice(0, 7) === prevKey).reduce((sum, tx) => sum + tx.amount, 0);
  const series = monthSeries(data.transactions, now.key, 6);
  const maxBar = Math.max(1, ...series.flatMap((row) => [row.expense, row.income]));
  const weeks = weekBuckets(data.transactions, now.key);
  const spend = daySpendMap(data.transactions, now.key);
  const daily = Array.from({ length: s.daysInMonth }, (_, i) => spend[`${now.key}-${String(i + 1).padStart(2, "0")}`] || 0);
  let compare = t("noCompare");
  if (prevExpense > 0 && s.expenses > 0) {
    const pct = Math.round(((s.expenses - prevExpense) / prevExpense) * 100);
    compare = `${pct > 0 ? "+" : ""}${pct}% ${pct === 0 ? t("same") : pct > 0 ? t("higher") : t("lower")}`;
  }
  return `${disc.ready ? `<section class="metrics">
      ${metric(t("score"), String(disc.score))}
      ${metric(t("noSpendDays"), String(disc.noSpend))}
      ${metric(t("noSpendStreak"), String(disc.noSpendStreak))}
      ${metric(t("withinStreak"), String(disc.withinStreak))}
    </section><p class="note">${esc(t("scoreHint"))}</p>` : `<section class="panel">${empty(t("notEnough"), t("notEnoughHint"))}</section>`}
    ${insight ? `<section class="panel"><h2>${esc(t("vsLast"))}</h2><p>${esc(insight.pct >= 0 ? t("catMore", { pct: String(insight.pct), cat: catLabel(insight.category) }) : t("catLess", { pct: String(Math.abs(insight.pct)), cat: catLabel(insight.category) }))}</p></section>` : `<section class="panel"><p class="note">${esc(t("noCompare"))}</p></section>`}
    <section class="metrics">
      ${metric(t("highestCat"), highest ? highest.label : t("noneYet"))}
      ${metric(t("avgDaily"), money(Math.round(s.expenses / elapsed)))}
      ${metric(t("monthSpend"), money(s.expenses))}
      ${metric(t("vsLast"), compare)}
    </section>
    <p class="note">${esc(t("avgHint"))}</p>
    <section class="grid-2">
      <div class="panel"><h2>${esc(t("byCategory"))}</h2>${cats.length ? donut(cats) : empty(t("noChart"), t("notEnoughHint"))}</div>
      <div class="panel"><h2>${esc(t("dailyChart"))}</h2>${lineChart(daily)}</div>
    </section>
    <section class="panel"><h2>${esc(t("monthlyChart"))}</h2><div class="cols">${series.map((row) => `<div class="col"><div class="col-track"><i style="height:${Math.round((row.expense / maxBar) * 100)}%"></i></div><span>${esc(row.key.slice(5))}</span></div>`).join("")}</div><p class="note">${esc(t("chartExpense"))}</p></section>
    <section class="panel"><h2>${esc(t("incomeVs"))}</h2>${hbars([{ label: t("chartIncome"), value: Math.max(0, series.reduce((s2, r) => s2 + r.income, 0)) }, { label: t("chartExpense"), value: Math.max(0, series.reduce((s2, r) => s2 + r.expense, 0)) }])}</section>
    <section class="panel"><h2>${esc(t("weekly"))}</h2>${weeks.map((w) => `<div class="hbar"><div class="hbar-top"><span>${esc(t("week"))} ${esc(w.label)}</span><b>${esc(money(w.expense))}</b></div>${progress(weeks.reduce((m, x) => Math.max(m, x.expense), 1) ? (w.expense / Math.max(1, ...weeks.map((x) => x.expense))) * 100 : 0, false)}</div>`).join("")}</section>
    <section class="panel"><h2>${esc(t("whatIf"))}</h2><p class="note">${esc(t("whatIfHint"))}</p>
      <div class="fields two">
        <label class="field">${esc(t("extraExpense"))}<input id="what-expense" data-bind="what-expense" inputmode="decimal" value="${esc(ui.whatExpense)}"></label>
        <label class="field">${esc(t("extraIncome"))}<input id="what-income" data-bind="what-income" inputmode="decimal" value="${esc(ui.whatIncome)}"></label>
      </div>
      <div id="what-result">${whatResultInner()}</div>
    </section>`;
}
function whatResultInner() {
  const expenseRaw = ui.whatExpense.trim();
  const incomeRaw = ui.whatIncome.trim();
  const extraE = expenseRaw ? validNonNegativePoisha(expenseRaw) : 0;
  const extraI = incomeRaw ? validNonNegativePoisha(incomeRaw) : 0;
  if (extraE == null || extraI == null) return `<p class="warn">${esc(t("amountInvalid"))}</p>`;
  const hypo = whatIf(summary(), extraE, extraI);
  return `<div class="split"><span>${esc(t("newRemaining"))}</span><b>${esc(money(hypo.remaining))}</b></div><div class="split"><span>${esc(t("newDaily"))}</span><b>${esc(money(hypo.daily))}</b></div>`;
}
function donut(slices) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const r = 15.9155;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const circles = slices.map((s, i) => {
    const len = (s.value / total) * c;
    const dash = Math.max(0, len - (slices.length > 1 ? 1.1 : 0));
    const node = `<circle cx="21" cy="21" r="${r}" fill="none" stroke="${COLORS[i % COLORS.length]}" stroke-width="6" stroke-dasharray="${dash} ${c - dash}" stroke-dashoffset="${-offset}"></circle>`;
    offset += len;
    return node;
  }).join("");
  const legend = slices.map((s, i) => `<li><i style="background:${COLORS[i % COLORS.length]}"></i><span>${esc(s.label)}</span><b>${esc(money(s.value))}</b></li>`).join("");
  return `<div class="donut-wrap"><svg class="donut" viewBox="0 0 42 42">${circles}</svg><ul class="legend">${legend}</ul></div>`;
}
function lineChart(values) {
  const w = 320;
  const h = 120;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (w - 16) / (values.length - 1) : 0;
  const pts = values.map((v, i) => `${8 + i * step},${h - 8 - (v / max) * (h - 16)}`).join(" ");
  return `<svg class="linechart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline points="${pts}"></polyline></svg>`;
}
function hbars(items) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (items.every((i) => i.value <= 0)) return empty(t("noChart"), t("notEnoughHint"));
  return items.map((i) => `<div class="hbar"><div class="hbar-top"><span>${esc(i.label)}</span><b>${esc(money(i.value))}</b></div>${progress((i.value / max) * 100, false)}</div>`).join("");
}
function viewMonths() {
  const keys = allMonthKeys();
  return `<p class="note">${esc(t("monthsSub"))}</p><div class="grid-3">${keys.map((key) => {
    const record = data.months[key] || { startingMoney: 0, carryIn: 0 };
    const day = key === now.key ? now.day : monthDays(key);
    const parts = { key, day, date: `${key}-${String(day).padStart(2, "0")}` };
    const s = calculateBudget({ transactions: data.transactions, budget: data.budget, monthRecord: record, parts });
    return `<article class="panel"><div class="eyebrow">${esc(formatMonth(key))}</div>
      <div class="split"><span>${esc(t("totalIncome"))}</span><b class="pos">${esc(money(s.income))}</b></div>
      <div class="split"><span>${esc(t("totalExpenses"))}</span><b class="neg">${esc(money(s.expenses))}</b></div>
      <div class="split"><span>${esc(t("savings"))}</span><b class="save">${esc(money(s.netSavings))}</b></div>
      <div class="split"><span>${esc(t("available"))}</span><b>${esc(money(s.available))}</b></div>
      ${key === now.key ? `<div class="split"><span>${esc(t("remainingBudget"))}</span><b>${esc(money(s.remaining))}</b></div>` : ""}
    </article>`;
  }).join("")}</div>`;
}
function allMonthKeys() {
  const set = new Set(Object.keys(data.months));
  for (const tx of data.transactions) {
    const key = String(tx.occurredAt).slice(0, 7);
    if (/^\d{4}-\d{2}$/.test(key)) set.add(key);
  }
  set.add(now.key);
  return [...set].sort().reverse();
}
function viewAlerts() {
  const items = data.notificationLog;
  return `<p class="note">${esc(t("notifExplain"))}</p>
    <div class="inline"><button class="btn ghost" type="button" data-action="notify-perm">${esc(t("enableBrowser"))}</button>
    ${items.length ? `<button class="btn ghost" type="button" data-action="mark-read">${esc(t("markRead"))}</button>` : ""}</div>
    <section class="panel">${items.length ? items.map((n) => `<article class="tx"><span class="bubble amber">${ico("bell")}</span><div><b>${esc(n.read ? t("read") : t("unread"))}</b><small>${esc(n.body)}</small></div><small>${esc(n.at?.slice(0, 10) || "")}</small></article>`).join("") : empty(t("alertsEmpty"), t("noAlertFilter"))}</section>`;
}
function viewSettings() {
  const n = data.settings.notifications;
  const toggle = (key, label) => `<label class="check"><input type="checkbox" data-bind="notif" data-key="${key}" ${n[key] ? "checked" : ""}> ${esc(label)}</label>`;
  return `<section class="panel"><h2>${esc(t("profile"))}</h2><p>${esc(data.profile.name)}</p><p class="note">${esc(t("savePrefs"))}</p>
      <label class="field">${esc(t("language"))}<select data-bind="lang">${opt("en", "English", lang())}${opt("bn", "বাংলা", lang())}</select></label>
      <label class="field">${esc(t("appearance"))}<select data-bind="theme">${opt("dark", t("dark"), data.settings.theme)}${opt("light", t("light"), data.settings.theme)}${opt("system", t("system"), data.settings.theme)}</select></label>
      <p class="note">${esc(t("currencyLine"))}</p>
    </section>
    <section class="panel"><h2>${esc(t("pin"))}</h2><p class="note">${esc(t("securityBody"))}</p>
      <div class="inline"><button class="btn primary" type="button" data-action="set-pin">${esc(data.profile.pin ? t("changePin") : t("setPin"))}</button>
      ${data.profile.pin ? `<button class="btn ghost" type="button" data-action="remove-pin">${esc(t("removePin"))}</button>` : ""}</div>
    </section>
    <section class="panel"><h2>${esc(t("alertsTitle"))}</h2>
      ${toggle("dailyReminder", t("dailyReminder"))}
      ${toggle("budgetWarning", t("budgetWarning"))}
      ${toggle("lowBalance", t("lowBalance"))}
      ${toggle("monthWarning", t("monthWarning"))}
      ${toggle("savings", t("savingsUpdates"))}
      ${toggle("monthlySummary", t("monthlySummary"))}
      <button class="btn ghost" type="button" data-action="notify-perm">${esc(t("enableBrowser"))}</button>
      <p class="note">${esc(t("notifExplain"))}</p>
    </section>
    <section class="panel"><h2>${esc(t("backup"))}</h2><p class="note">${esc(t("backupHint"))}</p>
      <div class="inline"><button class="btn ghost" type="button" data-action="export-json">${ico("download")} ${esc(t("exportJson"))}</button>
      <button class="btn ghost" type="button" data-action="export-csv">${ico("download")} ${esc(t("exportCsv"))}</button></div>
      <button class="btn ghost" type="button" data-action="pick-import">${ico("download")} ${esc(t("importJson"))}</button>
      <input id="import-file" type="file" accept="application/json,.json" hidden>
    </section>
    <section class="panel"><h2>${esc(t("erase"))}</h2><p class="note">${esc(t("eraseHint"))}</p>
      <form data-form="erase" class="inline"><input name="phrase" placeholder="${esc(t("typeDelete"))}" autocomplete="off"><button class="btn danger" type="submit">${esc(t("erase"))}</button></form>
      ${data.sample ? `<button class="btn danger" type="button" data-action="clear-sample">${esc(t("clearSample"))}</button>` : ""}
    </section>
    <section class="panel"><h2>${esc(t("about"))}</h2><p class="note">${esc(t("aboutBody"))}</p><p class="note">${esc(t("install"))}</p><p class="note">${esc(t("version"))}</p></section>`;
}
function viewMore() {
  const item = (view, icon, label) => `<button class="menu-item" type="button" data-action="nav" data-view="${view}">${ico(icon)} ${esc(label)}</button>`;
  return `<p class="note">${esc(t("moreSub"))}</p><div class="menu">
    ${item("budget", "wallet", t("navBudget"))}
    ${item("insights", "chart", t("navInsights"))}
    ${item("months", "calendar", t("navMonths"))}
    ${item("alerts", "bell", t("navAlerts"))}
    ${item("settings", "gear", t("navSettings"))}
  </div>`;
}
function viewWelcome() {
  const bn = lang() === "bn";
  return `<div class="welcome">
    <div class="welcome-card">
      <div class="mark">P</div>
      <h1>POCKETLY</h1>
      <p class="lead">${esc(t("welcomeLead") || t("tagline"))}</p>
      <p class="note" style="text-align:center">${esc(t("privacyNote"))}</p>
      <div class="lang-switch" role="group" aria-label="Language">
        <button type="button" class="${lang()==="en"?"on":""}" data-action="set-lang" data-lang="en">English</button>
        <button type="button" class="${lang()==="bn"?"on":""}" data-action="set-lang" data-lang="bn">বাংলা</button>
      </div>
      <form data-form="welcome" class="fields">
        <label class="field">${esc(t("yourName") || "Your name")}
          <input name="name" autocomplete="name" maxlength="40" placeholder="${esc(bn ? "আপনার নাম" : "Your name")}" required>
        </label>
        <button class="btn primary block" type="submit">${esc(t("startLedger") || (bn ? "খাতা শুরু করুন" : "Create my ledger"))}</button>
      </form>
      <button class="btn ghost block" type="button" data-action="sample">${esc(t("loadSample"))}</button>
      <p class="note" style="text-align:center">${esc(t("sampleNote"))}</p>
      <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap">
        ${installButtonHtml()}
        <button class="btn ghost" type="button" data-action="help">${ico("list")} ${esc(bn ? "কীভাবে ব্যবহার করবেন" : "How to use")}</button>
      </div>
    </div>
    ${helpOverlayHtml()}
    ${ui.modal === "install-help" ? installHelpHtml() : ""}
    ${ui.toast ? `<div id="toast" class="toast" role="status">${esc(ui.toast)}</div>` : ""}
  </div>`;
}
function viewLock() {
  const dots = Array.from({ length: 4 }, (_, i) => `<i class="${i < ui.pinEntry.length ? "on" : ""}"></i>`).join("");
  const keys = ["1","2","3","4","5","6","7","8","9","back","0","ok"];
  return `<div class="lock">
    <div class="mark" style="margin:0 auto">P</div>
    <h1>${esc(t("lockTitle"))}</h1>
    <p class="note" style="text-align:center">${esc(t("lockHint"))}</p>
    <div class="dots">${dots}</div>
    <p class="err" style="text-align:center">${esc(ui.pinError)}</p>
    <div class="pad">${keys.map((key) => `<button type="button" data-action="pin-key" data-key="${key}">${key === "back" ? "⌫" : key === "ok" ? "OK" : key}</button>`).join("")}</div>
  </div>`;
}
function pinModal() {
  const dots = Array.from({ length: 4 }, (_, i) => `<i class="${i < ui.pinEntry.length ? "on" : ""}"></i>`).join("");
  const keys = ["1","2","3","4","5","6","7","8","9","back","0"];
  const label = ui.pinFlow === "confirm" ? t("reenterPin") : t("enterPin");
  return `<div class="modal-back" data-action="close"><div class="modal" data-action="noop">
    <div class="ph"><h2>${esc(t("pin"))}</h2><button class="btn ghost" type="button" data-action="close">${ico("x")}</button></div>
    <p class="note">${esc(label)}</p><div class="dots">${dots}</div><p class="err">${esc(ui.pinError)}</p>
    <div class="pad">${keys.map((key) => `<button type="button" data-action="pin-key" data-key="${key}">${key === "back" ? "⌫" : key}</button>`).join("")}</div>
  </div></div>`;
}
function txDefaults() {
  const existing = ui.editingId ? data.transactions.find((tx) => tx.id === ui.editingId) : null;
  const base = existing ? {
    type: formType(existing),
    amount: takaStr(existing.amount),
    category: existing.category,
    goalId: existing.goalId || "general",
    date: existing.occurredAt.slice(0, 10),
    time: existing.occurredAt.slice(11, 16),
    paymentMethod: existing.paymentMethod || "cash",
    description: existing.description || "",
    notes: existing.notes || "",
  } : {
    type: ui.txType || "expense",
    amount: "",
    category: (ui.txType || "expense") === "income" ? "allowance" : "food",
    goalId: "general",
    date: now.date,
    time: now.time,
    paymentMethod: "cash",
    description: "",
    notes: "",
  };
  return { ...base, ...(ui.txDraft || {}) };
}
function txModal() {
  const d = txDefaults();
  const type = d.type;
  const savings = String(type).startsWith("savings");
  const kind = type === "income" ? "income" : "expense";
  const ids = kind === "income" ? INCOME_CATS : EXPENSE_CATS;
  const custom = data.categories.filter((c) => c.kind === kind).map((c) => c.id);
  return `<div class="modal-back" data-action="close"><form class="modal" id="tx-form" data-form="tx" data-action="noop">
    <div class="ph"><h2>${esc(ui.editingId ? t("editTx") : t("newTx"))}</h2><button class="btn ghost" type="button" data-action="close">${ico("x")}</button></div>
    <div class="fields two">
      <label class="field">${esc(t("type"))}<select name="type" data-bind="txtype">
        ${opt("expense", t("addExpense"), type)}${opt("income", t("addIncome"), type)}${opt("savings-out", t("toSavings"), type)}${opt("savings-in", t("fromSavings"), type)}
      </select></label>
      <label class="field">${esc(t("amount"))}<input name="amount" inputmode="decimal" required value="${esc(d.amount)}" placeholder="0.00"></label>
      ${savings ? `<label class="field">${esc(t("goal"))}<select name="goalId"><option value="general" ${d.goalId === "general" ? "selected" : ""}>${esc(t("generalSavings"))}</option>${data.goals.map((g) => `<option value="${esc(g.id)}" ${g.id === d.goalId ? "selected" : ""}>${esc(g.name)}</option>`).join("")}</select></label>` : `<label class="field">${esc(t("category"))}<select name="category">${[...ids, ...custom].map((id) => `<option value="${esc(id)}" ${id === d.category ? "selected" : ""}>${esc(catLabel(id))}</option>`).join("")}</select></label>`}
      <label class="field">${esc(t("method"))}<select name="paymentMethod">${PAY_METHODS.map((id) => `<option value="${id}" ${id === d.paymentMethod ? "selected" : ""}>${esc(payLabel(id))}</option>`).join("")}</select></label>
      <label class="field">${esc(t("date"))}<input name="date" type="date" required value="${esc(d.date)}"></label>
      <label class="field">${esc(t("time"))}<input name="time" type="time" value="${esc(d.time)}"></label>
      <label class="field">${esc(t("description"))}<input name="description" maxlength="140" value="${esc(d.description)}" placeholder="${esc(t("descriptionPh"))}"></label>
      <label class="field">${esc(t("notes"))}<input name="notes" maxlength="280" value="${esc(d.notes)}" placeholder="${esc(t("notesPh"))}"></label>
    </div>
    ${savings ? "" : `<div class="inline"><input id="new-cat" maxlength="32" placeholder="${esc(t("catName"))}"><button class="btn ghost" type="button" data-action="add-cat">${esc(t("addCategory"))}</button></div>`}
    <div class="inline"><button class="btn ghost" type="button" data-action="close">${esc(t("cancel"))}</button><button class="btn primary" type="submit">${esc(t("save"))}</button></div>
  </form></div>`;
}
function goalModal() {
  const existing = ui.editingGoal ? data.goals.find((g) => g.id === ui.editingGoal) : null;
  return `<div class="modal-back" data-action="close"><form class="modal" data-form="goal" data-action="noop">
    <div class="ph"><h2>${esc(existing ? t("editGoal") : t("newGoal"))}</h2><button class="btn ghost" type="button" data-action="close">${ico("x")}</button></div>
    <div class="fields">
      <label class="field">${esc(t("goalName"))}<input name="name" required maxlength="60" value="${esc(existing?.name || "")}" placeholder="${esc(t("goalPh"))}"></label>
      <label class="field">${esc(t("targetAmount"))}<input name="target" inputmode="decimal" required value="${existing ? esc(takaStr(existing.targetAmount)) : ""}" placeholder="20000"></label>
      <label class="field">${esc(t("targetDate"))}<input name="targetDate" type="date" value="${esc(existing?.targetDate || "")}"></label>
    </div>
    <div class="inline"><button class="btn ghost" type="button" data-action="close">${esc(t("cancel"))}</button><button class="btn primary" type="submit">${esc(t("save"))}</button></div>
  </form></div>`;
}
function addSheet() {
  const row = (type, icon, tone, label) => `<button class="quick" type="button" data-action="open-tx" data-type="${type}"><span class="bubble ${tone}">${ico(icon)}</span><span><b>${esc(label)}</b></span></button>`;
  return `<div class="modal-back" data-action="close"><div class="sheet" data-action="noop"><h2>${esc(t("openAdd"))}</h2>
    ${row("expense", "up", "red", t("addExpense"))}
    ${row("income", "down", "green", t("addIncome"))}
    ${row("savings-out", "target", "blue", t("toSavings"))}
    ${row("savings-in", "down", "green", t("fromSavings"))}
  </div></div>`;
}
function rolloverModal() {
  const month = data.months[now.key];
  if (!month || month.rollover !== "ask") return "";
  const prevKey = previousMonthKey(now.key);
  const prevRecord = data.months[prevKey] || { startingMoney: 0, carryIn: 0 };
  const end = availableAtMonthEnd(data.transactions, data.budget, prevRecord, prevKey);
  const amount = Math.max(0, end.available);
  if (amount <= 0) {
    return `<div class="modal-back"><div class="modal" data-action="noop"><h2>${esc(t("carryAsk"))}</h2><p>${esc(t("noSurplus", { month: formatMonth(prevKey), next: formatMonth(now.key) }))}</p><button class="btn primary" type="button" data-action="rollover" data-choice="fresh">${esc(t("noSurplusOk"))}</button></div></div>`;
  }
  return `<div class="modal-back"><div class="modal" data-action="noop"><h2>${esc(t("carryAsk"))}</h2><p>${esc(t("carryBody", { month: formatMonth(prevKey), next: formatMonth(now.key), amount: money(amount) }))}</p>
    <div class="inline"><button class="btn primary" type="button" data-action="rollover" data-choice="carry">${esc(t("carryYes"))}</button><button class="btn ghost" type="button" data-action="rollover" data-choice="fresh">${esc(t("carryNo"))}</button></div>
  </div></div>`;
}
function confirmModal() {
  if (!ui.confirm) return "";
  return `<div class="modal-back" data-action="confirm-no"><div class="modal" data-action="noop"><h2>${esc(t("confirmTitle"))}</h2><p>${esc(ui.confirm.body)}</p>
    <div class="inline"><button class="btn ghost" type="button" data-action="confirm-no">${esc(t("no"))}</button><button class="btn primary" type="button" data-action="confirm-ok">${esc(t("yes"))}</button></div>
  </div></div>`;
}
function overlay() {
  if (ui.confirm) return confirmModal();
  if (data.months[now.key]?.rollover === "ask") return rolloverModal();
  if (ui.modal === "add") return addSheet();
  if (ui.modal === "tx") return txModal();
  if (ui.modal === "goal") return goalModal();
  if (ui.modal === "pin") return pinModal();
  return "";
}
function captureTx() {
  const form = document.getElementById("tx-form");
  if (!form) return;
  ui.txDraft = Object.fromEntries(new FormData(form).entries());
  ui.txType = ui.txDraft.type || ui.txType;
}
function readBudget(form) {
  const fd = new FormData(form);
  const base = ui.budgetFields || data.budget;
  const mode = base.mode;
  const pick = (name, fallback) => {
    const raw = fd.get(name);
    if (raw == null) return fallback;
    return validNonNegativePoisha(raw);
  };
  const monthlyStartingMoney = pick("starting", base.monthlyStartingMoney);
  const savingsTarget = pick("savingsTarget", base.savingsTarget);
  const fixedExpenses = pick("fixed", base.fixedExpenses);
  const emergencyReserve = pick("emergency", base.emergencyReserve);
  const dailyLimit = pick("daily", base.dailyLimit);
  if ([monthlyStartingMoney, savingsTarget, fixedExpenses, emergencyReserve, dailyLimit].some((v) => v == null)) return null;
  return { mode, monthlyStartingMoney, savingsTarget, fixedExpenses, emergencyReserve, dailyLimit };
}
function saveTx(form) {
  const fd = new FormData(form);
  const rawType = String(fd.get("type") || "expense");
  const amount = validPositivePoisha(fd.get("amount"));
  if (amount == null) return toast(t("amountInvalid"));
  const date = String(fd.get("date") || now.date);
  const time = String(fd.get("time") || "12:00");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return toast(t("amountInvalid"));
  const type = rawType.startsWith("savings") ? "savings" : rawType;
  const direction = rawType === "income" || rawType === "savings-in" ? "in" : "out";
  let goalId = "";
  let category = String(fd.get("category") || (type === "income" ? "other_income" : "other"));
  if (type === "savings") {
    category = "savings";
    goalId = String(fd.get("goalId") || "");
    if (goalId === "general") goalId = "";
    if (direction === "in") {
      const others = data.transactions.filter((tx) => tx.id !== ui.editingId);
      const saved = goalId ? goalBalance(others, goalId) : unassignedSavings(others);
      if (amount > saved) return toast(t("insufficient"));
    }
  }
  const previous = data.transactions.find((tx) => tx.id === ui.editingId);
  const item = {
    id: ui.editingId || uid(),
    type, direction, amount, category, goalId,
    description: String(fd.get("description") || "").trim().slice(0, 140),
    notes: String(fd.get("notes") || "").trim().slice(0, 280),
    paymentMethod: String(fd.get("paymentMethod") || "cash"),
    occurredAt: `${date}T${time}`,
    createdAt: previous?.createdAt || Date.now(),
    updatedAt: Date.now(),
  };
  if (previous) data.transactions = data.transactions.map((tx) => (tx.id === item.id ? item : tx));
  else data.transactions.push(item);
  const key = date.slice(0, 7);
  if (!data.months[key]) data.months[key] = { startingMoney: key === now.key ? data.budget.monthlyStartingMoney : 0, carryIn: 0, rollover: "fresh" };
  ui.modal = null;
  ui.editingId = null;
  ui.txDraft = null;
  save();
  syncAlerts();
  toast(t("txSaved"));
}
function applyConfirm() {
  const confirm = ui.confirm;
  ui.confirm = null;
  if (!confirm) return;
  if (confirm.action === "do-delete-tx") {
    data.transactions = data.transactions.filter((tx) => tx.id !== confirm.id);
    ui.editingId = null;
    ui.modal = null;
    save();
    syncAlerts();
    toast(t("deleted"));
  } else if (confirm.action === "do-delete-goal") {
    data.transactions = data.transactions.map((tx) => (tx.goalId === confirm.id ? { ...tx, goalId: "" } : tx));
    data.goals = data.goals.filter((g) => g.id !== confirm.id);
    save();
    toast(t("deleted"));
  } else if (confirm.action === "commit-budget" && ui.pendingBudget) {
    data.budget = { ...data.budget, ...ui.pendingBudget };
    ensureMonth();
    data.months[now.key].startingMoney = ui.pendingBudget.monthlyStartingMoney;
    ui.budgetFields = null;
    ui.pendingBudget = null;
    save();
    syncAlerts();
    toast(t("budgetSaved"));
  } else if (confirm.action === "do-erase") {
    const language = lang();
    data = blankState();
    data.settings.language = language;
    save();
    try { sessionStorage.removeItem("pocketly.unlocked"); } catch { /* ignore */ }
    ui.view = "dash";
    toast(t("wiped"));
  } else if (confirm.action === "do-remove-pin") {
    if (data.profile) data.profile.pin = null;
    save();
    toast(t("pinOff"));
  }
  render();
}
function resolveRollover(choice) {
  const month = data.months[now.key];
  if (!month) return;
  const prevKey = previousMonthKey(now.key);
  const prevRecord = data.months[prevKey] || { startingMoney: 0, carryIn: 0 };
  const end = availableAtMonthEnd(data.transactions, data.budget, prevRecord, prevKey);
  month.carryIn = choice === "carry" ? Math.max(0, end.available) : 0;
  month.rollover = choice === "carry" ? "carry" : "fresh";
  save();
  toast(choice === "carry" ? t("carryDone") : t("freshDone"));
}
async function finishPin() {
  if (ui.modal === "pin") {
    if (ui.pinFlow === "set") {
      ui.pinFirst = ui.pinEntry;
      ui.pinEntry = "";
      ui.pinFlow = "confirm";
      render();
      return;
    }
    if (ui.pinEntry !== ui.pinFirst) {
      ui.pinError = t("pinMismatch");
      ui.pinEntry = "";
      ui.pinFlow = "set";
      ui.pinFirst = "";
      render();
      return;
    }
    const salt = uid();
    data.profile.pin = { salt, hash: await hashPin(ui.pinEntry, salt) };
    try { sessionStorage.setItem("pocketly.unlocked", "1"); } catch { /* ignore */ }
    ui.modal = null;
    ui.pinFlow = null;
    ui.pinEntry = "";
    ui.pinError = "";
    save();
    toast(t("pinOn"));
    return;
  }
  const pin = data.profile?.pin;
  if (!pin) return;
  const hash = await hashPin(ui.pinEntry, pin.salt);
  ui.pinEntry = "";
  if (hash === pin.hash) {
    ui.pinError = "";
    try { sessionStorage.setItem("pocketly.unlocked", "1"); } catch { /* ignore */ }
    render();
  } else {
    ui.pinError = t("wrongPin");
    render();
  }
}
function onClick(event) {
  const el = event.target.closest("[data-action]");
  if (!el || !event.currentTarget.contains(el)) return;
  const action = el.dataset.action;
  if (action === "noop") return;
  if (action === "help") { ui.helpStep = 0; ui.installHelp = true; render(); return; }
  if (action === "close-help") { ui.installHelp = false; render(); return; }
  if (action === "help-prev") { ui.helpStep = Math.max(0, ui.helpStep - 1); render(); return; }
  if (action === "help-next") { if (ui.helpStep >= 3) ui.installHelp = false; else ui.helpStep += 1; render(); return; }
  if (action === "install") {
    if (isStandaloneApp()) return toast(lang()==="bn"?"অ্যাপটি ইতোমধ্যে ইনস্টল করা আছে":"App is already installed");
    if (deferredInstallPrompt) {
      void deferredInstallPrompt.prompt().then(() => deferredInstallPrompt.userChoice).then((choice) => {
        deferredInstallPrompt = null;
        if (choice?.outcome === "accepted") toast(lang()==="bn"?"ইনস্টল শুরু হয়েছে":"Installation started");
        render();
      });
    } else { ui.modal = "install-help"; render(); }
    return;
  }
  if (action === "close-install") { ui.modal = null; render(); return; }
  if (action === "try-install") {
    if (deferredInstallPrompt) {
      void deferredInstallPrompt.prompt().then(() => deferredInstallPrompt.userChoice).then((choice) => {
        deferredInstallPrompt = null; ui.modal = null;
        if (choice?.outcome === "accepted") toast(lang()==="bn"?"ইনস্টল শুরু হয়েছে":"Installation started");
        render();
      });
    } else toast(lang()==="bn"?"ব্রাউজারের মেনু থেকে Install নির্বাচন করুন":"Use your browser menu to install this app");
    return;
  }
  if (action === "nav") return go(el.dataset.view);
  if (action === "close") {
    ui.modal = null;
    ui.txDraft = null;
    ui.editingId = null;
    ui.editingGoal = null;
    ui.pinFlow = null;
    ui.pinEntry = "";
    render();
    return;
  }
  if (action === "open-add") { ui.modal = "add"; ui.editingId = null; ui.txDraft = null; render(); return; }
  if (action === "open-tx") {
    ui.modal = "tx";
    ui.txType = el.dataset.type || "expense";
    ui.txDraft = el.dataset.goal ? { type: ui.txType, goalId: el.dataset.goal } : null;
    ui.editingId = null;
    render();
    return;
  }
  if (action === "edit-tx") {
    const tx = data.transactions.find((item) => item.id === el.dataset.id);
    if (!tx) return;
    ui.editingId = tx.id;
    ui.txType = formType(tx);
    ui.txDraft = null;
    ui.modal = "tx";
    render();
    return;
  }
  if (action === "delete-tx") { ui.confirm = { body: t("confirmDeleteTx"), action: "do-delete-tx", id: el.dataset.id }; render(); return; }
  if (action === "open-goal") { ui.editingGoal = null; ui.modal = "goal"; render(); return; }
  if (action === "edit-goal") { ui.editingGoal = el.dataset.id; ui.modal = "goal"; render(); return; }
  if (action === "delete-goal") { ui.confirm = { body: t("confirmDeleteGoal"), action: "do-delete-goal", id: el.dataset.id }; render(); return; }
  if (action === "mode") {
    const form = document.getElementById("budget-form");
    const read = form ? readBudget(form) : null;
    if (!read) return toast(t("amountInvalid"));
    ui.budgetFields = { ...read, mode: el.dataset.mode };
    render();
    return;
  }
  if (action === "add-cat") {
    captureTx();
    const name = document.getElementById("new-cat")?.value.trim() || "";
    if (!name) return;
    const kind = (ui.txDraft?.type || ui.txType) === "income" ? "income" : "expense";
    const id = `custom:${name.replace(/[<>"]/g, "").slice(0, 32)}`;
    if (!data.categories.some((c) => c.id === id)) data.categories.push({ id, name, kind });
    ui.txDraft = { ...(ui.txDraft || {}), category: id, type: ui.txDraft?.type || ui.txType };
    save();
    toast(t("catAdded"));
    return;
  }
  if (action === "lang") {
    data.settings.language = el.dataset.lang === "bn" ? "bn" : "en";
    save();
    applyTheme();
    render();
    return;
  }
  if (action === "set-lang") {
    const l = (event.target.closest("[data-lang]") || el).dataset.lang;
    data.settings.language = l === "bn" ? "bn" : "en";
    if (data.profile) save();
    applyTheme();
    render();
    return;
  }
  if (action === "sample" || action === "clear-sample") {
    if (action === "clear-sample") { ui.confirm = { body: t("startOverConfirm"), action: "do-erase" }; render(); return; }
    const form = document.querySelector('form[data-form="welcome"]');
    const fromForm = form ? String(new FormData(form).get("name") || "").trim() : "";
    const name = fromForm || document.getElementById("profile-name")?.value.trim() || (lang() === "bn" ? "নমুনা" : "Sample");
    startLedger(name, true);
    return;
  }
  if (action === "lock") {
    try { sessionStorage.removeItem("pocketly.unlocked"); } catch { /* ignore */ }
    ui.pinEntry = "";
    render();
    return;
  }
  if (action === "set-pin") { ui.modal = "pin"; ui.pinFlow = "set"; ui.pinEntry = ""; ui.pinFirst = ""; ui.pinError = ""; render(); return; }
  if (action === "remove-pin") { ui.confirm = { body: t("removePinConfirm"), action: "do-remove-pin" }; render(); return; }
  if (action === "pin-key") {
    const key = el.dataset.key;
    if (key === "back") ui.pinEntry = ui.pinEntry.slice(0, -1);
    else if (key === "ok") { if (ui.pinEntry.length === 4) void finishPin(); return; }
    else if (ui.pinEntry.length < 4) ui.pinEntry += key;
    ui.pinError = "";
    if (ui.pinEntry.length === 4 && key !== "back") { void finishPin(); return; }
    render();
    return;
  }
  if (action === "rollover") return resolveRollover(el.dataset.choice);
  if (action === "confirm-ok") return applyConfirm();
  if (action === "confirm-no") { ui.confirm = null; render(); return; }
  if (action === "export-json") return exportJson();
  if (action === "export-csv") return exportCsv();
  if (action === "pick-import") { document.getElementById("import-file")?.click(); return; }
  if (action === "mark-read") {
    data.notificationLog = data.notificationLog.map((n) => ({ ...n, read: true }));
    save();
    render();
    return;
  }
  if (action === "notify-perm") {
    if (!("Notification" in window)) return toast(t("permNA"));
    Notification.requestPermission().then((result) => toast(result === "granted" ? t("permGranted") : t("permDenied")));
  }
}
function onSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const kind = form.dataset.form;
  if (kind === "welcome") {
    const name = String(new FormData(form).get("name") || "").trim();
    if (!name) return toast(t("nameInvalid"));
    startLedger(name, false);
    return;
  }
  if (kind === "tx") return saveTx(form);
  if (kind === "goal") {
    const fd = new FormData(form);
    const name = String(fd.get("name") || "").trim();
    const target = validPositivePoisha(fd.get("target"));
    if (!name || target == null) return toast(t("goalInvalid"));
    const previous = data.goals.find((g) => g.id === ui.editingGoal);
    const goal = {
      id: previous?.id || uid(),
      name: name.slice(0, 60),
      targetAmount: target,
      targetDate: String(fd.get("targetDate") || ""),
      createdAt: previous?.createdAt || Date.now(),
    };
    if (previous) data.goals = data.goals.map((g) => (g.id === goal.id ? goal : g));
    else data.goals.push(goal);
    ui.modal = null;
    ui.editingGoal = null;
    save();
    syncAlerts();
    toast(t("created"));
    render();
    return;
  }
  if (kind === "budget") {
    const read = readBudget(form);
    if (!read) return toast(t("amountInvalid"));
    ui.pendingBudget = read;
    ui.confirm = { body: t("confirmBudget"), action: "commit-budget" };
    render();
    return;
  }
  if (kind === "erase") {
    if (String(new FormData(form).get("phrase") || "") !== "DELETE") return toast(t("eraseHint"));
    ui.confirm = { body: t("eraseConfirm"), action: "do-erase" };
    render();
  }
}
function onChange(event) {
  const el = event.target;
  if (!(el instanceof HTMLElement)) return;
  if (el.id === "import-file" && el instanceof HTMLInputElement) {
    const file = el.files?.[0];
    el.value = "";
    if (file) void importJson(file);
    return;
  }
  const bind = el.dataset.bind;
  if (bind === "type" || bind === "range" || bind === "sort" || bind === "cat" || bind === "from" || bind === "to") {
    ui[bind === "type" ? "type" : bind === "range" ? "range" : bind === "sort" ? "sort" : bind === "cat" ? "cat" : bind === "from" ? "from" : "to"] = el.value;
    render();
    return;
  }
  if (bind === "lang") { data.settings.language = el.value === "bn" ? "bn" : "en"; save(); applyTheme(); render(); return; }
  if (bind === "theme") { data.settings.theme = el.value; save(); applyTheme(); render(); return; }
  if (bind === "notif") { data.settings.notifications[el.dataset.key] = el.checked; save(); return; }
  if (bind === "txtype") { captureTx(); ui.txType = el.value; render(); }
}
function onInput(event) {
  const el = event.target;
  if (!(el instanceof HTMLElement)) return;
  if (el.dataset.bind === "search") {
    ui.search = el.value;
    const box = document.getElementById("history-list");
    if (box) box.innerHTML = historyListHtml();
    return;
  }
  if (el.dataset.bind === "what-expense" || el.dataset.bind === "what-income") {
    if (el.dataset.bind === "what-expense") ui.whatExpense = el.value;
    else ui.whatIncome = el.value;
    const out = document.getElementById("what-result");
    if (out) out.innerHTML = whatResultInner();
    return;
  }
  if (el.dataset.bind === "budget-field") {
    const form = document.getElementById("budget-form");
    const preview = document.getElementById("budget-preview");
    if (!form || !preview) return;
    const read = readBudget(form);
    if (read) preview.innerHTML = budgetPreviewInner(read);
  }
}
function onKey(event) {
  if (event.key !== "Escape") return;
  if (data.months[now.key]?.rollover === "ask") return;
  if (ui.confirm || ui.modal) {
    ui.confirm = null;
    ui.modal = null;
    ui.txDraft = null;
    render();
  }
}
function render() {
  const root = document.getElementById("pocketly");
  if (!root) return;
  now = dhakaParts();
  const theme = applyTheme();
  root.dataset.theme = theme;
  const active = document.activeElement;
  const focusId = active && root.contains(active) ? active.id : "";
  const sel = focusId && active && "selectionStart" in active ? active.selectionStart : null;
  let html;
  if (!data.profile) html = viewWelcome();
  else if (!unlocked()) html = viewLock();
  else {
    const view = ui.view === "dash" ? viewDash()
      : ui.view === "history" ? viewHistory()
      : ui.view === "budget" ? viewBudget()
      : ui.view === "savings" ? viewSavings()
      : ui.view === "insights" ? viewInsights()
      : ui.view === "months" ? viewMonths()
      : ui.view === "alerts" ? viewAlerts()
      : ui.view === "settings" ? viewSettings()
      : viewMore();
    html = shell(view);
  }
  if (!data.profile || !unlocked()) {
    html += ui.toast ? `<div id="toast" class="toast" role="status">${esc(ui.toast)}</div>` : "";
  }
  root.innerHTML = html;
  if (focusId) {
    const el = document.getElementById(focusId);
    if (el) {
      el.focus();
      if (sel != null && el.setSelectionRange) { try { el.setSelectionRange(sel, sel); } catch { /* number inputs */ } }
    }
  }
}
function boot() {
  const root = document.getElementById("pocketly");
  if (!root) return;
  if (!root.dataset.wired) {
    root.dataset.wired = "1";
    root.addEventListener("click", onClick);
    root.addEventListener("submit", onSubmit);
    root.addEventListener("change", onChange);
    root.addEventListener("input", onInput);
  }
  if (!window.__pocketlyKey) {
    window.__pocketlyKey = true;
    document.addEventListener("keydown", onKey);
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (data.settings.theme === "system") render();
    });
  }
  bindInstallPrompt();
  load();
  now = dhakaParts();
  if (data.profile) { ensureMonth(); syncAlerts(); }
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  render();
}

window.Pocketly = { boot };
boot();
