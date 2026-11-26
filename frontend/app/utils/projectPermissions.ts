import type { ProjectPermission, WorkspaceProject } from '~/types/workspace'

export function projectPermissionsFor(project: WorkspaceProject | null | undefined, userId: string | undefined): ProjectPermission[] {
  if (!project || !userId) return []
  const member = project.leader?.userId === userId
    ? project.leader
    : project.collaborators.find(item => item.userId === userId)
  return member?.permissions ?? []
}

/**
 * 授权表格的级联勾选规则，与后端 OfficeProjectPermission.encode 的约束一致：
 * 勾选任何权限隐含 READ；MARGIN_READ/EXPORT_QUOTE 隐含 QUOTE_READ；
 * 取消 READ 清空全部；取消 QUOTE_READ 联动取消 MARGIN_READ 与 EXPORT_QUOTE。
 */
export function toggleProjectPermission(current: ProjectPermission[], permission: ProjectPermission, checked: boolean): ProjectPermission[] {
  const flags = new Set(current)
  if (checked) {
    flags.add('READ')
    flags.add(permission)
    if (permission === 'MARGIN_READ' || permission === 'EXPORT_QUOTE') flags.add('QUOTE_READ')
  } else if (permission === 'READ') {
    flags.clear()
  } else {
    flags.delete(permission)
    if (permission === 'QUOTE_READ') {
      flags.delete('MARGIN_READ')
      flags.delete('EXPORT_QUOTE')
    }
  }
  return [...flags]
}
