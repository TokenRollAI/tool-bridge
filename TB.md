Tool-Bridge
	Vision
		MCP
			HTTP Streamble
		Context
			Source
				R2
				S3
				File
				Custom Provider
			Interface
				List
				Get
				Update
				Write
				Search
					Sementic
					Keyword
		Device
			Tool
			Context
			File
		Server
			Custom HTBP Server
	Capability
		Auth
			Can User / Agent DO(R/W/Registe) on Resource/Namespace
			Secret Key
				Which User/Agent
		Tool Provider
			MCP
			Custom
		Context Provider
			R2
			飞书
			FileSystem
			...
		Register
			Device
			Tool
			Context
		SDK
			run TB Server
			Register
				tool
				context
				HTTP -> WebSocket
		CLI
			Management
				list Tool/Context/Device
				Add TB Server
				Allow 反向注册
			Mount
				FileSystem
		Plugin
			Custom
				Tool
				Context
	UserCase
		Admin初始化
			用户本地使用 CLI 部署了在 CF 上运行的实例
				自动产生一个 Admin Api Key
			用户使用 Admin Api Key 登录
				查看当前的系统运行的状态
		添加 Context
			用户登录 Dashboard
			配置
				AK
				SK
				...
				Description
			使用
				Cli/Agent/Dashboard
					都可以查看/使用
		反向注册
			Server
				Server 上使用 cli + 远程 Domain + Register SK
				Server 和 远程TB Server 建立了双向通信(webSocket)
				自动注册 Device Path
				自动注册 Device/<id>/shell
				自动注册 Device/<id>/fs context
				Agent/Cli/... 可以正常访问这个 Device
		自部署
			默认 Cloudflare
				默认 Domain 为 tool-bridge.example.com
			支持 Docker 自部署
		Agent 使用
			提供一个 Agent SK + BaseURL
				自动获取 BaseURL/~help
				获得所有可访问的资源以及描述
					支持 Application/Json
					支持 Application/~help
		DashBoard 使用
			提供一个 SK + BaseURL
				自动获取 BaseURL/~help
				获得所有可访问的资源以及描述
					支持 Application/Json
					支持 Application/~help
				用户在表单上填写要填写的内容
				点击发送
				获取返回值
		cli 使用
			提供一个 SK + BaseURL
				自动获取 BaseURL/~help
				获得所有可访问的资源以及描述
					支持 Application/Json
					支持 Application/~help
				用户在表单上填写要填写的内容
				点击发送
				获取返回值
	注意
		0. 总是不手造轮子, 优先使用现代的成熟的框架, 如果没有, 优先调研
		1. 每个 SK 都要有对应的作用域 以及 域中的访问权限
		2. 反向注册时, 如果使用的 SK 指定了允许注册的path
			那么仅允许在这个path 下注册
		3. 反向注册时, 如果使用的 SK 未指定了允许注册的path
			允许注册保留 根 Path 之外的路径
		4. 注册 Path 为 a/b/c 时
			必须对 a/b/c 都提供~help 的能力
		5. 参考 htbp 协议构建
		6. 返回format 默认为 application/markdown
			只有在声明返回formart 为 application/json 时才返回 json
		7. 可以考虑增加 /~tree + query 限制 depth 的能力
		8. 从一开始就注意 SDK/Plugin 的支持
