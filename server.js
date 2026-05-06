const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config();
const express  = require('express');
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');
const cors     = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('.'));

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ MongoDB connected'))
  .catch(err => { console.error('❌ MongoDB connection error:', err); process.exit(1); });
//* ══════════════════════════════════════════════
//    SCHEMAS & MODELS
// ══════════════════════════════════════════════ 

const UserSchema = new mongoose.Schema({
  username:     { type: String, required: true, unique: true, lowercase: true, trim: true },
  name:         { type: String, required: true, trim: true },
  passwordHash: { type: String, required: true },
  joinedAt:     { type: String, default: () => new Date().toISOString() },
  lastChanged:  { type: String, default: null }
});
const User = mongoose.model('User', UserSchema);

const LogSchema = new mongoose.Schema({
  user_id:     { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  id:          Number,   // client-generated timestamp ID
  habitId:     String,
  habitName:   String,
  habitIcon:   String,
  date:        String,
  duration:    Number,
  unit:        String,
  displayUnit: String,
  startTime:   String,
  endTime:     String,
  note:        String,
  isQuickAlarm: Boolean,
  isSchedule:  Boolean,
  scheduleId:  Number
}, { timestamps: true });
const Log = mongoose.model('Log', LogSchema);

const AlarmSchema = new mongoose.Schema({
  user_id:  { type: mongoose.Schema.Types.ObjectId, required: true },
  habitId:  { type: String, required: true },
  from:     String,
  to:       String,
  active:   { type: Boolean, default: true }
});
// One alarm per user+habit
AlarmSchema.index({ user_id: 1, habitId: 1 }, { unique: true });
const Alarm = mongoose.model('Alarm', AlarmSchema);

const SettingsSchema = new mongoose.Schema({
  user_id:        { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  habitEnabled:   { type: mongoose.Schema.Types.Mixed, default: {} },
  selectedSounds: { type: mongoose.Schema.Types.Mixed, default: {} },
  customSounds:   { type: mongoose.Schema.Types.Mixed, default: {} }
});
const Settings = mongoose.model('Settings', SettingsSchema);

const QuickAlarmSchema = new mongoose.Schema({
  user_id:         { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  id:              Number,
  date:            String,
  fromTime:        String,
  toTime:          String,
  fromDisplay:     String,
  toDisplay:       String,
  duration:        String,
  durationMins:    Number,
  durationHrs:     Number,
  category:        String,
  isCustomCategory: Boolean,
  sound:           String,
  createdAt:       String
}, { timestamps: true });
const QuickAlarm = mongoose.model('QuickAlarm', QuickAlarmSchema);

const ScheduleSchema = new mongoose.Schema({
  user_id:     { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  id:          Number,
  category:    String,
  date:        String,
  fromTime:    String,
  toTime:      String,
  durationMins: Number,
  tasks:       [{ text: String, done: { type: Boolean, default: false } }],
  createdAt:   String,
  updatedAt:   String,
  fromCal:     Boolean,
  calTitle:    String
}, { timestamps: true });
const Schedule = mongoose.model('Schedule', ScheduleSchema);

const CheckInSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  date:    String,
  score:   Number,
  answers: mongoose.Schema.Types.Mixed
}, { timestamps: true });
const CheckIn = mongoose.model('CheckIn', CheckInSchema);

/* ══════════════════════════════════════════════
   AUTH ROUTES
══════════════════════════════════════════════ */

// POST /api/signup
app.post('/api/signup', async (req, res) => {
  try {
    const { username, name, password } = req.body;
    if (!username || !name || !password) return res.status(400).json({ error: 'All fields required.' });
    if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters.' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const exists = await User.findOne({ username: username.toLowerCase() });
    if (exists) return res.status(409).json({ error: 'Username already taken.' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ username, name, passwordHash });

    // Create default settings doc
    await Settings.create({ user_id: user._id });

    res.status(201).json({ id: user._id, joinedAt: user.joinedAt });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'All fields required.' });

    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Incorrect username or password.' });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ error: 'Incorrect username or password.' });

    res.json({ id: user._id, username: user.username, name: user.name, joinedAt: user.joinedAt, lastChanged: user.lastChanged });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/reset-password
app.post('/api/reset-password', async (req, res) => {
  try {
    const { username, newPassword } = req.body;
    if (!username || !newPassword) return res.status(400).json({ error: 'All fields required.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(404).json({ error: 'No account found with that User ID.' });

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.lastChanged  = new Date().toISOString();
    await user.save();

    res.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ══════════════════════════════════════════════
   USER ROUTES
══════════════════════════════════════════════ */

// GET /api/users/:id
app.get('/api/users/:id', async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-passwordHash');
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json({ id: user._id, username: user.username, name: user.name, joinedAt: user.joinedAt });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// PUT /api/users/:id  — update name and/or username
app.put('/api/users/:id', async (req, res) => {
  try {
    const { newName, newUsername } = req.body;
    if (!newName || !newUsername) return res.status(400).json({ error: 'Name and username cannot be empty.' });
    if (newUsername.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters.' });

    // Check username not taken by someone else
    const taken = await User.findOne({ username: newUsername.toLowerCase(), _id: { $ne: req.params.id } });
    if (taken) return res.status(409).json({ error: 'Username already taken.' });

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { name: newName, username: newUsername.toLowerCase() },
      { new: true }
    );
    if (!user) return res.status(404).json({ error: 'User not found.' });

    res.json({ ok: true, username: user.username, name: user.name });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ══════════════════════════════════════════════
   SETTINGS ROUTE
══════════════════════════════════════════════ */

// PUT /api/settings
app.put('/api/settings', async (req, res) => {
  try {
    const { user_id, habitEnabled, selectedSounds, customSounds } = req.body;
    await Settings.findOneAndUpdate(
      { user_id },
      { habitEnabled, selectedSounds, customSounds },
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Settings error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ══════════════════════════════════════════════
   USERDATA — load everything in one shot
══════════════════════════════════════════════ */

// GET /api/userdata?user_id=
app.get('/api/userdata', async (req, res) => {
  try {
    const { user_id } = req.query;
    if (!user_id) return res.status(400).json({ error: 'user_id required.' });

    const [logs, alarmRows, quickAlarms, schedules, settings, checkins] = await Promise.all([
      Log.find({ user_id }).sort({ createdAt: -1 }),
      Alarm.find({ user_id }),
      QuickAlarm.find({ user_id }).sort({ createdAt: -1 }),
      Schedule.find({ user_id }).sort({ date: 1, fromTime: 1 }),
      Settings.findOne({ user_id }),
      CheckIn.find({ user_id }).sort({ createdAt: 1 })
    ]);

    // Convert alarms array → object keyed by habitId (matches frontend shape)
    const alarmsObj = {};
    alarmRows.forEach(r => { alarmsObj[r.habitId] = { from: r.from, to: r.to, active: r.active }; });

    res.json({
      logs:           logs.map(docToLog),
      alarms:         alarmsObj,
      quickAlarms:    quickAlarms.map(docToQA),
      schedules:      schedules.map(docToSchedule),
      habitEnabled:   settings?.habitEnabled   || {},
      selectedSounds: settings?.selectedSounds || {},
      customSounds:   settings?.customSounds   || {},
      checkInHistory: checkins.map(r => ({ id: r._id, date: r.date, score: r.score, answers: r.answers }))
    });
  } catch (err) {
    console.error('Userdata error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ══════════════════════════════════════════════
   LOG ROUTES
══════════════════════════════════════════════ */

// POST /api/logs
app.post('/api/logs', async (req, res) => {
  try {
    const { user_id, id, habitId, habitName, habitIcon, date, duration, unit,
            displayUnit, startTime, endTime, note, isQuickAlarm, isSchedule, scheduleId } = req.body;

    // Upsert by client-generated id so re-saves don't duplicate
    const log = await Log.findOneAndUpdate(
      { user_id, id },
      { user_id, id, habitId, habitName, habitIcon, date, duration, unit,
        displayUnit, startTime, endTime, note, isQuickAlarm, isSchedule, scheduleId },
      { upsert: true, new: true }
    );
    res.status(201).json({ ok: true, _id: log._id });
  } catch (err) {
    console.error('Log error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// DELETE /api/logs/:id
app.delete('/api/logs/:id', async (req, res) => {
  try {
    await Log.deleteOne({ id: Number(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ══════════════════════════════════════════════
   ALARM ROUTES
══════════════════════════════════════════════ */

// POST /api/alarms  (upsert by user+habitId)
app.post('/api/alarms', async (req, res) => {
  try {
    const { user_id, habitId, from, to, active } = req.body;
    await Alarm.findOneAndUpdate(
      { user_id, habitId },
      { from, to, active },
      { upsert: true, new: true }
    );
    res.status(201).json({ ok: true });
  } catch (err) {
    console.error('Alarm error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ══════════════════════════════════════════════
   QUICK ALARM ROUTES
══════════════════════════════════════════════ */

// POST /api/quick-alarms
app.post('/api/quick-alarms', async (req, res) => {
  try {
    const { user_id, id, date, fromTime, toTime, fromDisplay, toDisplay,
            duration, durationMins, durationHrs, category, isCustomCategory, sound, createdAt } = req.body;

    const qa = await QuickAlarm.findOneAndUpdate(
      { user_id, id },
      { user_id, id, date, fromTime, toTime, fromDisplay, toDisplay,
        duration, durationMins, durationHrs, category, isCustomCategory, sound, createdAt },
      { upsert: true, new: true }
    );
    res.status(201).json({ ok: true, _id: qa._id });
  } catch (err) {
    console.error('QuickAlarm error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ══════════════════════════════════════════════
   SCHEDULE ROUTES
══════════════════════════════════════════════ */

// POST /api/schedules
app.post('/api/schedules', async (req, res) => {
  try {
    const { user_id, id, category, date, fromTime, toTime, durationMins, tasks, createdAt, fromCal, calTitle } = req.body;
    const sc = await Schedule.findOneAndUpdate(
      { user_id, id },
      { user_id, id, category, date, fromTime, toTime, durationMins, tasks: tasks || [], createdAt, fromCal, calTitle },
      { upsert: true, new: true }
    );
    res.status(201).json({ ok: true, _id: sc._id });
  } catch (err) {
    console.error('Schedule error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// PUT /api/schedules/:id
app.put('/api/schedules/:id', async (req, res) => {
  try {
    const { category, date, fromTime, toTime, durationMins, tasks } = req.body;
    await Schedule.findOneAndUpdate(
      { id: Number(req.params.id) },
      { category, date, fromTime, toTime, durationMins, tasks: tasks || [], updatedAt: new Date().toISOString() }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// DELETE /api/schedules/:id
app.delete('/api/schedules/:id', async (req, res) => {
  try {
    await Schedule.deleteOne({ id: Number(req.params.id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

// PATCH /api/schedules/:id/task  — toggle a single task's done state
app.patch('/api/schedules/:id/task', async (req, res) => {
  try {
    const { taskIdx, done } = req.body;
    const sc = await Schedule.findOne({ id: Number(req.params.id) });
    if (!sc) return res.status(404).json({ error: 'Schedule not found.' });
    if (sc.tasks[taskIdx] !== undefined) {
      sc.tasks[taskIdx].done = done;
      sc.markModified('tasks');
      await sc.save();
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ══════════════════════════════════════════════
   CHECK-IN ROUTES
══════════════════════════════════════════════ */

// POST /api/checkins
app.post('/api/checkins', async (req, res) => {
  try {
    const { user_id, date, score, answers } = req.body;
    const ci = await CheckIn.create({ user_id, date, score, answers });
    res.status(201).json({ ok: true, _id: ci._id });
  } catch (err) {
    console.error('CheckIn error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

/* ══════════════════════════════════════════════
   HELPERS — map Mongoose docs → frontend shape
══════════════════════════════════════════════ */
function docToLog(r) {
  return {
    id: r.id, habitId: r.habitId, habitName: r.habitName, habitIcon: r.habitIcon,
    date: r.date, duration: r.duration, unit: r.unit, displayUnit: r.displayUnit,
    startTime: r.startTime, endTime: r.endTime, note: r.note,
    isQuickAlarm: r.isQuickAlarm, isSchedule: r.isSchedule, scheduleId: r.scheduleId
  };
}
function docToQA(r) {
  return {
    id: r.id, date: r.date, fromTime: r.fromTime, toTime: r.toTime,
    fromDisplay: r.fromDisplay, toDisplay: r.toDisplay,
    duration: r.duration, durationMins: r.durationMins, durationHrs: r.durationHrs,
    category: r.category, isCustomCategory: r.isCustomCategory,
    sound: r.sound, createdAt: r.createdAt
  };
}
function docToSchedule(r) {
  return {
    id: r.id, category: r.category, date: r.date, fromTime: r.fromTime, toTime: r.toTime,
    durationMins: r.durationMins, tasks: r.tasks || [],
    createdAt: r.createdAt, updatedAt: r.updatedAt, fromCal: r.fromCal, calTitle: r.calTitle
  };
}

/* ══════════════════════════════════════════════
   START
══════════════════════════════════════════════ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅  Quick Tracker server running → http://localhost:${PORT}`);
  console.log(`   Open http://localhost:${PORT}/spttool.html in your browser\n`);
});

// const dns = require('node:dns');
// dns.setServers(['8.8.8.8', '8.8.4.4']); // Force Google DNS for this process

const dns = require('node:dns');
dns.setDefaultResultOrder('ipv4first');