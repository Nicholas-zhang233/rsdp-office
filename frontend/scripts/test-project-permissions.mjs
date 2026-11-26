import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import vm from 'node:vm'

const source = stripTypeScriptTypes(await readFile(new URL('../app/utils/projectPermissions.ts', import.meta.url), 'utf8'))
  .replaceAll('export function', 'function')
const { toggleProjectPermission } = vm.runInNewContext(source + '\n({ toggleProjectPermission })', {})

// vm 上下文的数组原型不同，统一用 JSON 比较排序后的内容
function grants(current, permission, checked) {
  return JSON.stringify(toggleProjectPermission(current, permission, checked).slice().sort())
}
const expect = expected => JSON.stringify([...expected].sort())

// 勾选任何权限都隐含项目查看
assert.equal(grants([], 'EDIT', true), expect(['EDIT', 'READ']))
assert.equal(grants([], 'EXPORT_PROJECT', true), expect(['EXPORT_PROJECT', 'READ']))
assert.equal(grants([], 'MANAGE_MEMBERS', true), expect(['MANAGE_MEMBERS', 'READ']))
assert.equal(grants([], 'QUOTE_READ', true), expect(['QUOTE_READ', 'READ']))
assert.equal(grants([], 'READ', true), expect(['READ']))

// 毛利查看与报价导出级联报价查看；方案导出不牵连报价权限
assert.equal(grants([], 'MARGIN_READ', true), expect(['MARGIN_READ', 'QUOTE_READ', 'READ']))
assert.equal(grants([], 'EXPORT_QUOTE', true), expect(['EXPORT_QUOTE', 'QUOTE_READ', 'READ']))

// 取消项目查看清空全部
assert.equal(grants(['READ', 'EDIT', 'QUOTE_READ', 'MARGIN_READ'], 'READ', false), expect([]))

// 取消报价查看联动取消毛利查看与报价导出
assert.equal(grants(['READ', 'QUOTE_READ', 'MARGIN_READ', 'EXPORT_QUOTE'], 'QUOTE_READ', false), expect(['READ']))

// 取消其他权限保留其余
assert.equal(grants(['READ', 'EDIT', 'QUOTE_READ'], 'EDIT', false), expect(['QUOTE_READ', 'READ']))
assert.equal(grants(['READ', 'QUOTE_READ', 'MARGIN_READ'], 'MARGIN_READ', false), expect(['QUOTE_READ', 'READ']))

// 重复勾选幂等
const granted = toggleProjectPermission([], 'MARGIN_READ', true)
assert.equal(grants(granted, 'MARGIN_READ', true), grants([], 'MARGIN_READ', true))

// 取消未持有的权限不产生变化
assert.equal(grants(['READ'], 'EDIT', false), expect(['READ']))

console.log('PASS: 授权勾选级联（隐含READ、报价级联、取消联动、幂等）')
