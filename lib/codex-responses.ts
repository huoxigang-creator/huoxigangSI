export type CodexMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[];
  tool_call_id?: string;
  responseItems?: any[];
};

// Replay original output items, including encrypted reasoning, on tool rounds.
export function codexInput(messages: CodexMessage[]) {
  return messages.flatMap((message): any[] => {
    if (message.role === 'tool') return [{ type: 'function_call_output', call_id: message.tool_call_id, output: message.content || '' }];
    if (message.role === 'assistant' && message.responseItems) return message.responseItems;
    return [{ role: message.role, content: message.content || '' }];
  });
}

export function codexMessage(data: any): CodexMessage {
  if (data.status !== 'completed' || !Array.isArray(data.output)) {
    throw new Error(data.status === 'incomplete' ? 'Codex 回复未完成，请缩小问题范围后重试' : 'Codex 没有返回完整内容');
  }
  return {
    role: 'assistant', responseItems: data.output,
    content: data.output.filter((item: any) => item.type === 'message')
      .flatMap((item: any) => item.content || [])
      .filter((item: any) => item.type === 'output_text' || item.type === 'refusal')
      .map((item: any) => item.text || item.refusal || '').join('\n'),
    tool_calls: data.output.filter((item: any) => item.type === 'function_call').map((item: any) => ({
      id: item.call_id, type: 'function', function: { name: item.name, arguments: item.arguments },
    })),
  };
}
