// ░▒▓█ D3VCR4F7 API — Productivity Stats █▓▒░
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'

// GET /api/stats — Productivity stats (today, week, all time, chart)
export async function GET() {
  try {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const doneMissions = await prisma.mission.findMany({
      where: { status: 'done', score: { not: null } },
      select: { id: true, name: true, score: true, endedAt: true },
    })

    const todayMissions = doneMissions.filter(m => m.endedAt && new Date(m.endedAt) >= todayStart)
    const todayScore = todayMissions.reduce((sum, m) => sum + (m.score || 0), 0)

    const weekMissions = doneMissions.filter(m => m.endedAt && new Date(m.endedAt) >= sevenDaysAgo)
    const weekScore = weekMissions.reduce((sum, m) => sum + (m.score || 0), 0)

    const allTimeScore = doneMissions.reduce((sum, m) => sum + (m.score || 0), 0)

    // 8-day chart (today + 7 previous)
    const weeklyData = []
    for (let i = 7; i >= 0; i--) {
      const dayStart = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      dayStart.setHours(0, 0, 0, 0)
      const dayEnd = new Date(dayStart)
      dayEnd.setHours(23, 59, 59, 999)

      const dayMissions = doneMissions.filter(m => {
        if (!m.endedAt) return false
        const ended = new Date(m.endedAt)
        return ended >= dayStart && ended <= dayEnd
      })

      weeklyData.push({
        date: dayStart.toISOString().split('T')[0],
        score: dayMissions.reduce((sum, m) => sum + (m.score || 0), 0),
        missions: dayMissions.map(m => ({ id: m.id, name: m.name, score: m.score || 0 })),
      })
    }

    return NextResponse.json({
      today: Math.round(todayScore * 10) / 10,
      week: Math.round(weekScore * 10) / 10,
      allTime: Math.round(allTimeScore * 10) / 10,
      weeklyData,
    })
  } catch (error) {
    console.error('[D3VCR4F7] Stats error:', error)
    return NextResponse.json({ today: 0, week: 0, allTime: 0, weeklyData: [] }, { status: 500 })
  }
}
