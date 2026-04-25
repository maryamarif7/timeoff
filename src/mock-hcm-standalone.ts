
import express from 'express';

const app = express();
app.use(express.json());

const balances: Record<string, number> = {};

app.post('/__mock/config', (req, res) => {
  if (req.body.balances) Object.assign(balances, req.body.balances);
  res.json({ ok: true });
});

app.post('/leave/validate', (req, res) => {
  const { employeeId, locationId, leaveType, days } = req.body;
  const key = `${employeeId}:${locationId}:${leaveType}`;
  const balance = balances[key] ?? 10;
  res.json({ valid: balance >= days, reason: balance < days ? 'Insufficient balance' : undefined });
});

app.post('/leave/deduct', (req, res) => {
  const { employeeId, locationId, leaveType, days } = req.body;
  const key = `${employeeId}:${locationId}:${leaveType}`;
  balances[key] = (balances[key] ?? 10) - days;
  res.json({ success: true, reference: `ref-${Date.now()}` });
});

app.post('/leave/credit', (req, res) => {
  const { employeeId, locationId, leaveType, days } = req.body;
  const key = `${employeeId}:${locationId}:${leaveType}`;
  balances[key] = (balances[key] ?? 0) + days;
  res.json({ success: true });
});

app.get('/balance/:employeeId/:locationId/:leaveType', (req, res) => {
  const { employeeId, locationId, leaveType } = req.params;
  const balance = balances[`${employeeId}:${locationId}:${leaveType}`] ?? 10;
  res.json({ balance, version: `v-${Date.now()}` });
});

app.listen(4000, () => console.log('Mock HCM running on http://localhost:4000'));