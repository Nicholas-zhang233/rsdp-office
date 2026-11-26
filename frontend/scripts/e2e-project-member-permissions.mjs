import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const baseUrl = process.env.BASE_URL || 'http://localhost:3001'
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined })

const leader = { userId: 'U-2', username: 'lead', displayName: '项目负责人', role: 'LEADER', permissions: ['READ', 'EDIT', 'MANAGE_MEMBERS'] }
const designer = grants => ({ userId: 'U-3', username: 'designer', displayName: '空间设计师', role: 'COLLABORATOR', permissions: grants })
const dealerAccount = { userId: 'DEALER-1', username: 'dealer', displayName: '开发经销商主号', role: 'DEALER' }
const designerAccount = { userId: 'U-3', username: 'designer', displayName: '空间设计师', role: 'USER' }

function projectWith(collaboratorGrants) {
  return {
    projectId: 'PROJ-1', name: '权限测试项目', customerRequirements: '', requirementsRevision: 1,
    status: 'DESIGNING', canManageStatus: false,
    leader: { ...leader }, collaborators: [designer(collaboratorGrants)], referenceImages: [],
    floors: [{ projectId: 'PROJ-1', floorId: 'FLOOR-1', name: '1F', sortOrder: 1 }],
  }
}

const confirmedZone = {
  id: 'Z1', kind: 'zone', x: 0, y: 0, w: 5000, h: 4000, name: '开放办公区',
  zoneType: 'OPEN_OFFICE', seats: 10, note: '', tone: 'blue', confirmed: true, reviewUnit: 'mm',
}
const canvasWithZone = {
  objects: [confirmedZone], files: [], mode: 'overview', designZoneId: null,
  revision: 1, schemeToken: 'SCHEME-1', blank: false,
}

/** 每个身份独立的浏览器上下文：mock 登录身份与项目 API，捕获成员保存 payload 并回显。 */
async function openAs(account, collaboratorGrants, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const state = { project: projectWith(collaboratorGrants), memberSaves: [], quote: options.quote ?? null }
  await context.route('**/api/auth/me', route => route.fulfill({ json: { code: 200, data: account } }))
  await context.route('**/api/v1/**', route => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const respond = data => route.fulfill({ json: { code: 200, message: '成功', data } })
    if (path === '/api/v1/office/projects' && request.method() === 'GET') return respond([state.project])
    if (path === '/api/v1/office/projects/budgets') return respond({})
    if (path === '/api/v1/office/projects/PROJ-1/members' && request.method() === 'PUT') {
      const body = request.postDataJSON()
      state.memberSaves.push(body)
      state.project = {
        ...state.project,
        leader: { ...state.project.leader, permissions: body.permissions?.[state.project.leader.userId] ?? state.project.leader.permissions },
        collaborators: state.project.collaborators.map(member => ({
          ...member, permissions: body.permissions?.[member.userId] ?? member.permissions,
        })),
      }
      return respond(state.project)
    }
    if (path === '/api/v1/office/projects/PROJ-1/quotation/latest') return respond(state.quote)
    if (path.endsWith('/canvas')) return respond(canvasWithZone)
    if (path === '/api/v1/office/products') return respond([])
    return respond(path.endsWith('/proposal-confirmation') ? null : [])
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  return { context, page, state, errors }
}

const sorted = list => [...(list || [])].sort()

try {
  // 1. 经销商主号在授权表格勾选并保存：payload 必须带级联后的权限，重开后回显
  {
    const { page, state, errors, context } = await openAs(dealerAccount, ['READ'])
    await page.goto(`${baseUrl}/workspace/project-bench`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: '项目工作台', exact: true }).waitFor()
    await page.getByTitle('编辑项目名称和楼层名称', { exact: true }).click()
    const dialog = page.getByRole('heading', { name: '编辑项目与楼层', exact: true })
    await dialog.waitFor()
    const grantsTable = page.getByRole('table', { name: '项目成员权限' })
    await grantsTable.waitFor()

    const marginBox = page.getByRole('checkbox', { name: '空间设计师的毛利查看' })
    const quoteBox = page.getByRole('checkbox', { name: '空间设计师的报价查看' })
    assert.equal(await quoteBox.isChecked(), false)
    await marginBox.check()
    assert.equal(await quoteBox.isChecked(), true, '勾选毛利查看必须级联报价查看')
    assert.equal(await page.getByRole('checkbox', { name: '空间设计师的项目查看' }).isChecked(), true, '勾选任何权限必须级联项目查看')
    await page.getByRole('checkbox', { name: '空间设计师的项目编辑' }).check()
    await page.getByRole('checkbox', { name: '空间设计师的报价导出' }).check()
    await page.getByRole('checkbox', { name: '空间设计师的成员管理' }).check()

    await page.getByRole('button', { name: '保存修改', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.equal(state.memberSaves.length, 1, '保存必须调用一次成员替换接口')
    const body = state.memberSaves[0]
    assert.equal(body.leaderUserId, 'U-2')
    assert.deepEqual(body.collaboratorUserIds, ['U-3'])
    assert.deepEqual(sorted(body.permissions['U-3']),
      sorted(['READ', 'EDIT', 'QUOTE_READ', 'MARGIN_READ', 'EXPORT_QUOTE', 'MANAGE_MEMBERS']),
      '保存 payload 中的协作者权限必须与勾选及级联一致')
    assert.deepEqual(sorted(body.permissions['U-2']), sorted(['READ', 'EDIT', 'MANAGE_MEMBERS']), '负责人权限保持原授权')

    // 重开对话框：勾选状态从保存结果回显（验证读取链路）
    await page.getByTitle('编辑项目名称和楼层名称', { exact: true }).click()
    await dialog.waitFor()
    assert.equal(await page.getByRole('checkbox', { name: '空间设计师的毛利查看' }).isChecked(), true, '毛利查看必须回显为已授权')
    assert.equal(await page.getByRole('checkbox', { name: '空间设计师的报价导出' }).isChecked(), true, '报价导出必须回显为已授权')
    assert.equal(await page.getByRole('checkbox', { name: '空间设计师的方案导出' }).isChecked(), false, '未授权的方案导出保持未勾选')
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
    await context.close()
    console.log('PASS 1/4: 经销商授权保存 payload 与回显')
  }

  // 2. 只有项目查看权限的协作者：编辑、报价、导出、成员管理入口全部隐藏
  {
    const { page, errors, context } = await openAs(designerAccount, ['READ'])
    await page.goto(`${baseUrl}/workspace/project-bench`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: '项目工作台', exact: true }).waitFor()
    assert.equal(await page.getByTitle('管理项目成员').count(), 0, '无成员管理权限不得显示项目设置入口')
    assert.equal(await page.getByRole('button', { name: '＋ 添加新楼层' }).count(), 0, '无项目编辑权限不得显示添加楼层')

    await page.getByTestId('workspace-center-trigger').click()
    const panel = page.getByTestId('workspace-center-panel')
    await panel.waitFor()
    assert.equal(await panel.getByRole('link', { name: '商品报价' }).count(), 0, '无报价查看权限不得显示报价入口')
    assert.equal(await panel.getByRole('link', { name: '工作区账号' }).count(), 0, '普通协作者不得显示账号管理入口')

    await page.goto(`${baseUrl}/proposal?floorId=FLOOR-1`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: '整体方案与清单' }).waitFor()
    assert.equal(await page.getByRole('button', { name: '导出方案清单 CSV' }).count(), 0, '无方案导出权限不得显示导出按钮')
    assert.equal(await page.getByRole('button', { name: '确认方案' }).count(), 0, '无项目编辑权限不得显示确认方案')
    assert.equal(await page.getByRole('link', { name: '返回继续设计' }).count(), 0, '无项目编辑权限不得显示返回设计')
    await page.getByRole('link', { name: '查看空间总览' }).waitFor()
    assert.deepEqual(errors, [])
    await context.close()
    console.log('PASS 2/4: READ-only 协作者的编辑/报价/导出/成员入口隐藏')
  }

  // 3. 有报价查看、无毛利查看与报价导出的协作者：报价页按后端裁剪数据渲染且导出隐藏
  {
    const maskedQuote = {
      quotationId: 'QT-1', projectId: 'PROJ-1', projectName: '权限测试项目', revision: 1, status: 'CONFIRMED',
      pricingMode: null, pricingValue: null, goodsTotal: 600, serviceFee: 0, logisticsFee: 0, fees: [],
      totalAmount: 600, lineCount: 1, missingPriceLines: null, createdBy: 'DEALER-1', createdAt: '2026-11-26T10:00:00',
      lines: [{ productName: '办公桌', variant: '标准规格', qty: 2, factoryPrice: null, unitPrice: 300, subtotal: 600, issue: null }],
    }
    const { page, errors, context } = await openAs(designerAccount, ['READ', 'QUOTE_READ'], { quote: maskedQuote })
    await page.goto(`${baseUrl}/workspace/project-bench`, { waitUntil: 'networkidle' })
    await page.getByTestId('workspace-center-trigger').click()
    const panel = page.getByTestId('workspace-center-panel')
    await panel.waitFor()
    await panel.getByRole('link', { name: '商品报价' }).click()
    await page.waitForURL('**/workspace/quotes')
    await page.getByText('报价合计 ¥600', { exact: true }).waitFor()
    assert.equal(await page.getByText('报价系数', { exact: false }).count(), 0, '后端裁剪 pricingMode 后不得显示报价口径')
    assert.equal(await page.getByRole('columnheader', { name: '出厂价' }).count(), 0, '无毛利查看权限不得显示出厂价列')
    assert.equal(await page.getByRole('columnheader', { name: '商品毛利' }).count(), 0, '无毛利查看权限不得显示毛利列')
    await page.getByRole('columnheader', { name: '成交单价' }).waitFor()
    await page.getByRole('cell', { name: '300', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '导出已确认报价' }).count(), 0, '无报价导出权限不得显示导出按钮')
    assert.deepEqual(errors, [])
    await context.close()
    console.log('PASS 3/4: QUOTE_READ 协作者的报价查看与毛利裁剪渲染')
  }

  // 4. 有编辑与方案导出的协作者：编辑入口可用、方案导出可见，报价与成员管理仍受控
  {
    const { page, errors, context } = await openAs(designerAccount, ['READ', 'EDIT', 'EXPORT_PROJECT'])
    await page.goto(`${baseUrl}/workspace/project-bench`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: '项目工作台', exact: true }).waitFor()
    await page.getByTitle('编辑项目名称和楼层名称', { exact: true }).waitFor()
    await page.getByRole('button', { name: '＋ 添加新楼层' }).waitFor()

    // 非主号即使可编辑也看不到授权表格（授权仅经销商主号）
    await page.getByTitle('编辑项目名称和楼层名称', { exact: true }).click()
    await page.getByRole('heading', { name: '编辑项目与楼层', exact: true }).waitFor()
    assert.equal(await page.getByRole('table', { name: '项目成员权限' }).count(), 0, '非经销商主号不得显示授权表格')
    await page.getByRole('button', { name: '关闭', exact: true }).click()

    await page.goto(`${baseUrl}/proposal?floorId=FLOOR-1`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: '整体方案与清单' }).waitFor()
    await page.getByRole('button', { name: '导出方案清单 CSV' }).waitFor()
    await page.getByRole('button', { name: '确认方案' }).waitFor()

    // 无报价查看权限时直接访问报价页被拦
    await page.goto(`${baseUrl}/workspace/quotes`, { waitUntil: 'networkidle' })
    await page.getByText('当前账号暂无报价查看权限。', { exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '导出已确认报价' }).count(), 0)
    assert.deepEqual(errors, [])
    await context.close()
    console.log('PASS 4/4: EDIT+EXPORT_PROJECT 协作者的编辑/方案导出入口与报价拦截')
  }

  console.log('E2E member permissions passed: grant payload + echo, READ-only gating, quote masking, edit/export gating.')
} finally {
  await browser.close()
}
