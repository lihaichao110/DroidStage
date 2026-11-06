/**
 * 空任务引导：通过原创插画说明工作流程，并引导用户配置第一个步骤。
 */
import robotWorkflow from '../assets/robot-workflow.png'
import { UiIcon } from './ui-icon'

/**
 * 装饰插画与文字分开渲染，避免图片文字模糊且支持无障碍阅读。
 * @param props 开始配置步骤的回调
 * @returns 空任务引导区
 */
export function WorkflowEmptyState({ onAdd }: { onAdd: () => void }) {
  return <div className="flow-empty">
    <div className="workflow-art-space" aria-hidden="true">
      <div className="workflow-art">
        <img src={robotWorkflow} alt="" />
        <div className="workflow-art-numbers"><span>1</span><span>2</span><span>3</span></div>
      </div>
    </div>
    <strong>还没有任务步骤</strong>
    <p>通过添加步骤，组合点击、输入、滑动等操作，完成安卓设备的自动化任务。</p>
    <button className="primary" onClick={onAdd}><UiIcon name="plus" />添加第一个步骤</button>
  </div>
}
