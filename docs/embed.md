文本向量化代码参考：
```python

from openai import OpenAI, APIError, APIConnectionError

client = OpenAI(base_url="http://10.190.179.61:11999/embed/v1", api_key="Ecq+V/yugSNaJXN4v/OFlan14i08M4g9uaNEKXAAoE2njKcDKSJ5+GBb+NeouJ0N1HLDv5MxU2aWJ39G2ba/GF7+zm2Fi5/iauMxoDL3W28e75ZMRweimlab6JY7/Kwdju+uuUCkABjzjup6VKpNOBwv388jnIWyBE15qS8qmTw=")

try:
    response = client.embeddings.create(
        model="qwen3-embed-0.6b",
        input=["电磁阀电流控制方法", "PWM占空比调节技术"]
    )
    for i, emb in enumerate(response.data):
        print(f"[{i}] 向量维度: {len(emb.embedding)}, 前5维: {emb.embedding[:5]}")

except APIConnectionError:
    print("❌ 错误：无法连接到服务器，请检查 URL 是否正确或服务是否启动。")
except APIError as e:
    # 这里会打印出服务端返回的详细错误信息，如 "model not found"
    print(f"❌ API 错误：{e.message}")
except Exception as e:
    print(f"❌ 发生未知错误：{e}")
```