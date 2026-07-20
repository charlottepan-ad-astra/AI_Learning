# Supabase 操作指南(零基础版)

配合 database_specification_v1.md 使用,跟着下面的步骤一步步操作即可。

---

## 第一步:打开你的项目

1. 登录 [supabase.com](https://supabase.com),进入你已经创建好的项目。
2. 进入项目后,你会看到左侧一排图标菜单,常用的是:
   - **Table Editor**(表格图标):像Excel一样查看和编辑数据
   - **SQL Editor**(</> 图标):写SQL语句建表、查数据
   - **Authentication**(钥匙图标):管理登录用户
   - **Settings**(齿轮图标):项目配置,包括API密钥

---

## 第二步:执行建表SQL

1. 点击左侧的 **SQL Editor** 图标。
2. 点击右上角 **+ New query** 新建一个查询窗口。
3. 打开 `database_specification_v1.md` 文件,把"四、完整建表SQL"那一整段代码(从`create extension`到最后一行`disable row level security`)全部复制。
4. 粘贴到SQL Editor的编辑框里。
5. 点击右下角(或右上角)的 **Run** 按钮(或按快捷键 Ctrl/Cmd + Enter)执行。
6. 如果一切顺利,下方会显示 `Success. No rows returned`,说明9张表都建好了。

**如果报错怎么办:**
- 如果报错提示某张表已存在(`already exists`),说明你之前执行过一部分,可以先执行 `drop table if exists 表名 cascade;` 把对应表删掉再重新执行整段SQL。
- 如果报错和`auth.users`有关,检查一下Supabase项目是不是已经开启了Authentication功能(默认是开启的,一般不用额外设置)。

---

## 第三步:验证表是否建好

1. 点击左侧 **Table Editor** 图标。
2. 左边栏应该能看到9张表:`profiles`、`learning_plans`、`knowledge_points`、`chat_messages`、`questions`、`attempts`、`wrong_questions`、`learning_progress`、`resources`。
3. 点击任意一张表,能看到列出来的字段(列名),这时候表里还没有数据,是空的,属于正常情况。

---

## 第四步:手动插入一条测试数据(验证表能不能正常读写)

1. 先创建一个测试用户:点击左侧 **Authentication** 图标 → **Users** 标签 → **Add user** → 随便填一个测试邮箱和密码 → 创建。
2. 创建成功后,复制这个用户的 **UID**(一串UUID,页面上能看到)。
3. 回到 **SQL Editor**,新建一个query,粘贴下面的语句,把`你复制的UID`替换成刚才复制的那串UUID,执行:

```sql
insert into public.profiles (id, username, interest, learning_style)
values ('你复制的UID', '测试用户', array['Python','篮球'], 'Video');

insert into public.learning_plans (user_id, subject, goal, level)
values ('你复制的UID', 'Python', '掌握基础语法', 'Beginner');
```

4. 去 **Table Editor** 里打开`profiles`和`learning_plans`两张表,应该能看到刚插入的这条数据。看到数据说明整套流程跑通了。

---

## 第五步:获取连接信息(给后端代码用)

你后面写后端代码(Node.js/Python)时,需要用到这两个值来连接Supabase:

1. 点击左侧 **Settings**(齿轮图标)→ **API**。
2. 找到并复制这两项:
   - **Project URL**(形如 `https://xxxxx.supabase.co`)
   - **anon public key**(一长串字符,是给前端/客户端用的公开密钥)
   - 如果需要在后端做更高权限的操作(绕过RLS),还会用到 **service_role key**,这个密钥权限很高,**不要写进前端代码或提交到公开的Git仓库**,只能在后端环境变量里使用。
3. 把这两个值存到你项目的环境变量文件里(比如`.env`),不要直接写死在代码里:

```
SUPABASE_URL=https://xxxxx.supabase.co
SUPABASE_ANON_KEY=你的anon key
```
（是Supabase最近改了后台界面导致的,把原来"Settings → API"这一个页面拆成了两块,所以你在两个地方都没找全是正常的——它们本来就分开了。具体去哪找:
1. Project URL,去 Data API 里找
路径是 Settings → Data API(不是API Keys)。这个页面里能看到项目的URL(形如https://xxxxx.supabase.co)。
2. Key,去 API Keys 里找,但现在名字变了
路径是 Settings → API Keys。这里现在分两个标签页:

Legacy API Keys 标签页:这里能找到你要的传统的 anon public key,格式跟我之前说的一样(一长串以eyJ开头的字符串)。
API Keys 标签页(新的):Supabase现在推荐用一种新格式的key,叫 publishable key(格式类似sb_publishable_xxx),作用和anon key是一样的——都是给客户端/前端用的公开密钥。如果这个标签页下还没有key,可能需要点一下"Create new API keys"才会生成。

你该用哪个? 两者功能等价,黑客松阶段随便选一个都行,但建议优先用新的publishable key(在API Keys标签页里),因为Supabase官方说明里提到旧的anon/service_rolekey在2026年下半年会逐步下线,现在开始用新的更保险,以后不用中途换。
对应到.env文件里,写法上稍微调整一下:
SUPABASE_URL=你在Data API页面找到的URL
SUPABASE_ANON_KEY=你在API Keys页面复制的publishable key(或者legacy anon key)
变量名SUPABASE_ANON_KEY只是你自己起的名字,不影响功能,不用纠结叫"anon"还是"publishable",代码里用这个变量名去调用就行。)
---

## 第六步:在代码里连接Supabase(以Node.js为例)

```bash
npm install @supabase/supabase-js
```

```javascript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// 示例:查询某个用户的学习计划
const { data, error } = await supabase
  .from('learning_plans')
  .select('*')
  .eq('user_id', '某个用户的UID');

if (error) console.error(error);
else console.log(data);
```

如果用Python(FastAPI),对应的是`supabase-py`库,用法类似,需要的话告诉我你最终选的是哪个技术栈,我可以针对性给你写对应的连接代码。

---

## 常见问题

**Q: 为什么SQL Editor里执行插入语句成功了,但Table Editor里手动点"Insert row"却报错?**
A: 大概率是外键约束问题(比如你填的`user_id`在`auth.users`里不存在),先确认Authentication里有对应的测试用户。

**Q: 数据插入不进去,报错提示RLS相关?**
A: 说明前面"disable row level security"那几行没有执行成功,回到SQL Editor单独执行一遍那几行`alter table ... disable row level security;`。

**Q: 想清空某张表重新测试?**
A: 在SQL Editor执行 `truncate table 表名 cascade;` 即可清空数据但保留表结构。
