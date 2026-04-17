/**
 * Hawkeye Sterling V2 - Enterprise Dashboard UI
 * Real-time compliance monitoring and task management
 */

import React, { useState, useEffect } from 'react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const EnterpriseDashboard = () => {
  const [complianceScore, setComplianceScore] = useState(87);
  const [tasks, setTasks] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [metrics, setMetrics] = useState({
    totalTasks: 156,
    completedTasks: 98,
    overdueTasks: 12,
    highRiskTasks: 8,
    pendingReviews: 15,
  });

  // Mock data for charts
  const complianceTrend = [
    { month: 'Jan', score: 75 },
    { month: 'Feb', score: 78 },
    { month: 'Mar', score: 82 },
    { month: 'Apr', score: 85 },
    { month: 'May', score: 87 },
  ];

  const taskDistribution = [
    { name: 'Completed', value: 98, color: '#10b981' },
    { name: 'In Progress', value: 46, color: '#3b82f6' },
    { name: 'Pending', value: 12, color: '#f59e0b' },
  ];

  const riskLevels = [
    { level: 'Critical', count: 3 },
    { level: 'High', count: 8 },
    { level: 'Medium', count: 35 },
    { level: 'Low', count: 110 },
  ];

  useEffect(() => {
    // Simulate real-time data updates
    const interval = setInterval(() => {
      setComplianceScore(prev => Math.min(100, prev + Math.random() * 2 - 0.5));
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 min-h-screen p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-white mb-2">Compliance Dashboard</h1>
        <p className="text-slate-400">Real-time compliance monitoring and task management</p>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
        <MetricCard title="Compliance Score" value={`${complianceScore.toFixed(1)}%`} color="bg-emerald-500" />
        <MetricCard title="Total Tasks" value={metrics.totalTasks} color="bg-blue-500" />
        <MetricCard title="Completed" value={metrics.completedTasks} color="bg-green-500" />
        <MetricCard title="Overdue" value={metrics.overdueTasks} color="bg-red-500" />
        <MetricCard title="High Risk" value={metrics.highRiskTasks} color="bg-orange-500" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* Compliance Trend */}
        <div className="lg:col-span-2 bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h2 className="text-xl font-bold text-white mb-4">Compliance Score Trend</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={complianceTrend}>
              <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
              <XAxis stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} />
              <Line type="monotone" dataKey="score" stroke="#10b981" strokeWidth={3} dot={{ fill: '#10b981', r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Task Distribution */}
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h2 className="text-xl font-bold text-white mb-4">Task Distribution</h2>
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={taskDistribution} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value">
                {taskDistribution.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Risk Analysis */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h2 className="text-xl font-bold text-white mb-4">Risk Distribution</h2>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={riskLevels}>
              <CartesianGrid strokeDasharray="3 3" stroke="#475569" />
              <XAxis stroke="#94a3b8" dataKey="level" />
              <YAxis stroke="#94a3b8" />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: '1px solid #475569' }} />
              <Bar dataKey="count" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Recent Alerts */}
        <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
          <h2 className="text-xl font-bold text-white mb-4">Recent Alerts</h2>
          <div className="space-y-3">
            <AlertItem severity="critical" title="Sanctions Match Detected" time="2 minutes ago" />
            <AlertItem severity="high" title="Overdue KYC Verification" time="1 hour ago" />
            <AlertItem severity="medium" title="Regulatory Update Available" time="3 hours ago" />
            <AlertItem severity="low" title="Training Reminder" time="5 hours ago" />
          </div>
        </div>
      </div>

      {/* Pending Tasks */}
      <div className="bg-slate-800 rounded-lg p-6 border border-slate-700">
        <h2 className="text-xl font-bold text-white mb-4">Pending Tasks</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700">
                <th className="text-left py-3 px-4 text-slate-400">Task</th>
                <th className="text-left py-3 px-4 text-slate-400">Assignee</th>
                <th className="text-left py-3 px-4 text-slate-400">Due Date</th>
                <th className="text-left py-3 px-4 text-slate-400">Priority</th>
                <th className="text-left py-3 px-4 text-slate-400">Status</th>
              </tr>
            </thead>
            <tbody>
              <TaskRow task="KYC Verification - Customer #1234" assignee="John Smith" dueDate="2026-05-15" priority="High" status="In Progress" />
              <TaskRow task="Sanctions Screening - Batch #567" assignee="Sarah Johnson" dueDate="2026-05-10" priority="Critical" status="Pending" />
              <TaskRow task="AML Monitoring - Weekly Review" assignee="Mike Davis" dueDate="2026-05-20" priority="High" status="In Progress" />
              <TaskRow task="Regulatory Compliance Review" assignee="Emma Wilson" dueDate="2026-05-31" priority="High" status="Pending" />
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

const MetricCard = ({ title, value, color }) => (
  <div className={`${color} rounded-lg p-6 text-white shadow-lg transform hover:scale-105 transition`}>
    <p className="text-sm font-medium opacity-90">{title}</p>
    <p className="text-3xl font-bold mt-2">{value}</p>
  </div>
);

const AlertItem = ({ severity, title, time }) => {
  const severityColors = {
    critical: 'bg-red-500/20 border-red-500 text-red-300',
    high: 'bg-orange-500/20 border-orange-500 text-orange-300',
    medium: 'bg-yellow-500/20 border-yellow-500 text-yellow-300',
    low: 'bg-blue-500/20 border-blue-500 text-blue-300',
  };

  return (
    <div className={`border-l-4 p-3 rounded ${severityColors[severity]}`}>
      <p className="font-semibold">{title}</p>
      <p className="text-xs opacity-75">{time}</p>
    </div>
  );
};

const TaskRow = ({ task, assignee, dueDate, priority, status }) => {
  const priorityColor = {
    Critical: 'text-red-400',
    High: 'text-orange-400',
    Medium: 'text-yellow-400',
    Low: 'text-green-400',
  };

  const statusColor = {
    'In Progress': 'bg-blue-500/20 text-blue-300',
    Pending: 'bg-yellow-500/20 text-yellow-300',
    Completed: 'bg-green-500/20 text-green-300',
  };

  return (
    <tr className="border-b border-slate-700 hover:bg-slate-700/50">
      <td className="py-3 px-4 text-white">{task}</td>
      <td className="py-3 px-4 text-slate-300">{assignee}</td>
      <td className="py-3 px-4 text-slate-300">{dueDate}</td>
      <td className={`py-3 px-4 font-semibold ${priorityColor[priority]}`}>{priority}</td>
      <td className="py-3 px-4">
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusColor[status]}`}>{status}</span>
      </td>
    </tr>
  );
};

export default EnterpriseDashboard;
