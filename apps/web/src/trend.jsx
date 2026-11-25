import React from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export default function Trend({ data }) {
  return <div className="trend-chart"><ResponsiveContainer width="100%" height="100%">
    <BarChart data={data}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={(date) => date.slice(5)} />
      <YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="bookings" name="Reservations created" fill="#481126" />
      <Bar dataKey="bookedNights" name="Booked room-nights" fill="#C6A66B" /></BarChart>
  </ResponsiveContainer></div>;
}
