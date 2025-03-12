const canvas = obj('canvas');
const ctx = canvas.getContext('2d');
const socket = io();
const g = obj('game');
hide(g);
obj('iframe').style.opacity = 0;
hide(obj('iframe'));
const name = location.href.includes('?')?decodeURI(location.href.split('?')[1]):prompt('Enter Name');

(function(global){
	const MAP = loadImage('assets/map.jpg');
	const tree = loadImage('assets/tree.jpg');
	const EF = {};
	global.EF = EF;
	var cards = [];
	var trees = [];
	var clips = [];
	var past_river = [];
	var show_hint=false,big_card=false,big_clip=null;
	const tree_circles = [31, 37, 43, 17, 20, 23, 73, 51, 58, 62, 68, 79, 83];
	var finishTurn;
	var current_dice = null;
	var turn;
	var guesstreeprom;
	var gotCard = false;
	var people;
	var pboxes = [];
	var dice = [];
	var MY_TURN = false;
	var must_use_dice = false;

	for(let i=0;i<13;i++){
		let name = 'assets/'+('00'+i).slice(-2)+'.jpg';
		cards.push({img:loadImage(name),ix:i});
	}

	mouse.start(canvas);
	keys.start();
	Touch.init(data=>{
		mouse.pos.x = data.pos.x;
		mouse.pos.y = data.pos.y;
		mouse.down = true;
		setTimeout(()=>{
			mouse.down = false;
		},300);
	});

	xml('assets/positions.json',data=>{
		let objs = JSON.parse(data);
		let ix = 0;
		for(let obj of objs) {
			new Circle(obj,ix++);
		}
		xml('assets/connections.json',data=>{
			let objs = JSON.parse(data);
			for(let obj of objs){
				Circle.all[obj.t].addCon(Circle.all[obj.f]);
			}
		});
	});
	xml('assets/treepos.json',data=>{
		let objs = JSON.parse(data);
		let ix = 0;
		for(let obj of objs){
			new Tree(obj,ix++);
		}
	});
	xml('assets/river.json',data=>{
		past_river = JSON.parse(data);
	});

	serverRequests();
	function serverRequests(){
		socket.emit('EF-setup',name);
		socket.on('EF-delgame',()=>{location.href='./index.html?'+name});
		socket.on('EF-chooseColor',async e=>{
			show(obj('wait'));
			hide(obj('main'));
			chooseColor().then(color=>{
				socket.emit('EF-color',color);
			});
		});
		socket.on('EF-gobutton',e=>{
			let b = create('button','Start');
			obj('wait').appendChild(b);
			var opt_div = create('div');
			b.on('click',e=>{
				var opts = [...opt_div.querySelectorAll('input')].map(e=>+e.checked).join('');
				socket.emit('EF-begin',opts);
			});
			opt_div.id = 'options';
			opt_div.innerHTML = '<h3>Game Options</h3>';
			opt_div.appendChild(create('p','Stop at 3 Cards'));
			opt_div.appendChild(createSlider());
			opt_div.appendChild(create('p','Play until all cards are gone'));
			opt_div.innerHTML += '<br>';
			opt_div.appendChild(create('p','Using Dice is Optional'));
			opt_div.appendChild(createSlider());
			opt_div.appendChild(create('p','Both Dice are Required'));
			opt_div.innerHTML += '<br>';
			obj('wait').appendChild(opt_div);
		});
		socket.on('EF-waitdata',e=>{
			people = e;
			obj('peoplein').innerHTML = '';
			for(let person of e){
				let els = document.querySelectorAll('.color');
				for(let el of els){
					if(el.style.backgroundColor==person.color){
						el.remove();
					}
				}
				let p = create('p',person.name);
				p.style.color = person.color.length?person.color:'white';
				obj('peoplein').appendChild(p);
			}
		});
		socket.on('EF-join',e=>{
			let r = create('div',e.name+' wants to join!');
			r.classList.add('req');
			r.innerHTML += '<br>';
			let a = create('div','✔');
			let x = create('div','❌');
			a.style.display='inline';
			x.style.display='inline';
			a.style.fontSize='30px';
			x.style.fontSize='30px';
			a.style.float='right';
			x.style.float='left';
			r.appendChild(a);
			r.appendChild(x);
			a.on('click',()=>{
				r.remove();
				socket.emit('EF-accept',e);
			})
			x.on('click',e=>{
				r.remove();
			})
			obj('req').appendChild(r);
		});
		socket.on('EF-lobby',ppl=>{
			obj('#people').innerHTML = '';
			for(let p of ppl){
				let ln = create('p',p);
				ln.classList.add('ppl');
				obj('#people').appendChild(ln);
				ln.on('click',e=>{socket.emit('EF-request_join_game',p)});
			}
		});
		socket.on('dc',person=>{
			Piece.all.splice(person.ix,1);
			obj('#players').children[person.ix].remove();
		});
		socket.on('EF-game_start',data=>{
			hide(obj('lobby'));
			show(obj('game'));
			obj('game').style.display='';
			listPlayers();
			setup(data);
			loop();
		});
		socket.on('EF-turn',data=>{
			turn = data;
			pboxes = [...obj('#players').children];
			for(let pbox of pboxes){
				pbox.style.border = '5px solid #222';
			}
			pboxes[data.pix].style.border = '5px solid yellow';
			if(data.name == name){
				MY_TURN = true;
				myTurn(data).then(done=>{
					socket.emit('EF-nextturn');
				});
			} else {
				//Not  my turn
				MY_TURN = false;
			}
		});
		socket.on('EF-showPoints',data=>{
			setPoints(data);
		})
		socket.on('EF-otherturn',data=>{
			if(MY_TURN) return;
			let piece = Piece.all[data.person];
			data.data = data.data.split(' ');
			if(data.data[0] == 'showdice'){
				rollDice(turn.d1,turn.d2,false);
			} else if(data.data[0] == 'moveto'){
				let path = data.data[1].split(',').map(e=>Circle.all[e]);
				piece.walkPath(path).then(circle=>{
					movePieceData(piece,circle);
				});
			} else if(data.data[0] == 'shuffle'){
				shuffleCards();
			} else if(data.data[0] == 'popdeck'){
				cards.shift();
				console.log('PopDeck');
			} else if(data.data[0] == 'guess'){
				let tree_ix = Number(data.data[1]);
				Tree.all[tree_ix].shiny = true;
				setTimeout(()=>{
					Tree.all[tree_ix].shiny = false;
				},3000);
			}
		});
		socket.on('EF-winner',displayWinner);
	}

	function createSlider(){
		let label = create('label');
		label.classList.add('switch');
		let input = create('input');
		input.type = 'checkbox';
		let span = create('span');
		span.classList.add('slider');
		label.appendChild(input);
		label.appendChild(span);
		return label;
		//	<label class="switch">
		//		<input type="checkbox">
		//		<span class="slider"></span>
		//	</label>
	}

	function displayWinner(winner){
		obj('#win').innerHTML = winner;
		show(obj('#win'));
	}

	async function myTurn(data){
		gotCard = false;
		await rollDice(data.d1,data.d2);
		let p = new Promise((res,rej)=>{
			finishTurn = () => {
				res(gotCard);
			}
		});
		let info = await p;
		finishTurn = null;
	}

	function loadImage(src){
		let img = new Image;
		img.src = src;
		return img;
	}

	let a=16807,seed=1,c=0,m=2147483647;
	function pRandom(){
		let pnr = (a*seed+c)%m;
		let r = seed/m;
		seed = pnr;
		return r;
	}

	function setSeed(s=1){
		a=16807;
		seed=s;
		c=0;
		m=2147483647;
	}

	Array.prototype.rChoose = function(useseed=false){
		if(useseed){
			return this[pRandBetween(0,this.length-1)];
		} else {
			return this[random(0,this.length-1)];
		}
	}

	async function rollDice(n1,n2,popup=true){
		let iframe;
		dice = [];
		if(popup){
			iframe = obj('iframe');
			mouse.down = false;
			let prom = new Promise((res,rej)=>{
				iframe.onload = function(){
					show(iframe);
					iframe.style.opacity = 1;
					iframe.contentWindow.callback = function(){
						setTimeout(res,500);
					}
				}
				iframe.src = `rolldice.html?${n1}.${n2}`;
			});
			await prom;
			socket.emit('EF-turninfo','showdice');
		}
		let d1 = new Button(425,480,25,25,click=>{
			if(!MY_TURN) return;
			current_dice = d1;
		},loadImage(`assets/dice${n1}.jpg`));
		d1.num = n1;
		let d2 = new Button(425+30,480,25,25,click=>{
			if(!MY_TURN) return;
			current_dice = d2;
		},loadImage(`assets/dice${n2}.jpg`));
		var onkey = false;
		let magic,shuffle,guess;
		d2.num = n2;
		if(n1==n2){
			magic = new Button(425-30,480,25,25,click=>{
				if(!MY_TURN) return;
				current_dice = magic;
			},loadImage('assets/magic.png'));
			magic.num = 'm';
			shuffle = new Button(622,292,25,25,click=>{
				if(!MY_TURN) return;
				for(let d of dice) if(!d.resist){d.hide()}else{d.show()}
				current_dice = null;
				for(let c of Circle.all) c.isOpt = false;
				shuffleCards();
				socket.emit('EF-turninfo','shuffle');
			},loadImage('assets/shuffle.png'));
		}
		if(Piece.all[turn.pix].circle.ix == 123 && MY_TURN){
			onkey = true;
			guess = new Button(622-30,292,25,25,click=>{
				for(let d of dice) if(!d.resist){d.hide()}else{d.show()}
				current_dice = null;
				keyLand();
				current_dice = null;
				for(let c of Circle.all) c.isOpt = false;
			},loadImage('assets/guess.png'));
		}
		let done = new Button(425+60+50,480,50,25,click=>{
			d1.hide();
			d2.hide();
			done.hide();
			if(magic) magic.hide();
			if(shuffle) shuffle.hide();
			Tree.light = false;
			current_dice = null;
			for(let c of Circle.all) c.isOpt = false;
			if(finishTurn) finishTurn();
			else console.warn('Finish Turn didn\'t work');
		},loadImage(`assets/done.png`));
		done.resist = true;
		if(must_use_dice) done.hide();
		if(popup){
			dice = [d1,d2,done];
			if(n1==n2){
				dice.push(magic);
				dice.push(shuffle);
			}
			if(onkey) dice.push(guess);
			iframe.contentWindow.callback = null;
			iframe.style.opacity = 0;
			setTimeout(()=>{
				hide(iframe);
			},400);
		} else {
			dice = [d1,d2];
		}
	}

	function pRandBetween(min,max){
		return Math.floor(min+pRandom()*(max-min+1));
	}

	async function chooseColor(){
		let p = new Promise((res,rej)=>{
			let c = document.querySelectorAll('.color');
			for(let el of c){
				el.on('click',e=>{
					let c = el.style.backgroundColor;
					hide(obj('colors'));
					res(c);
				});
			}
		});
		return await p;
	}

	function shuffleCards(){
		cards = cards.sort((a,b)=>pRandom()-.5);
	}

	function listPlayers(){
		let parent = obj('#players');
		for(let p of people){
			let div = create('div',p.name+' (0)');
			div.classList.add('player');
			div.style.color = p.color;
			parent.appendChild(div);
			pboxes.push(div);
		}
	}

	function setPoints(players){
		let divs = obj('#players').children;
		for(let i=0;i<players.length;i++){
			divs[i].innerHTML = `${players[i].name} (${players[i].points})`
		}
	}

	function setup(data){
		setSeed(data.seed);
		for(let i=0;i<1000;i++) pRandom();
		must_use_dice = !!+data.opts[1];
		clips = getClips(cards);
		clips = clips.sort((a,b)=>pRandom()-.5);
		for(let i=0;i<13;i++){
			Tree.all[i].assignHint(clips[i].ix,clips[i].img);
		}
		shuffleCards();
		if(people){
			for(let i=0;i<people.length;i++){
				new Piece(people[i].color,i);
			}
		}
	}

	function getClips(cards){
		let cnv = create('canvas');
		let cctx = cnv.getContext('2d');
		var clips = [];
		let ix = 0;
		for(let card of cards){
			cnv.width = 255*2;
			cnv.height = 255*2;
			cctx.beginPath();
			cctx.arc(340-82,368-109,255,0,Math.PI*2);
			cctx.clip();
			cctx.drawImage(card.img,-82,-109);
			let o = {img:loadImage(cnv.toDataURL()),ix:ix++}
			clips.push(o);
		}
		return clips;
	}

	function loop(){
		setTimeout(loop,1000/30);
		ctx.clearRect(-2,-2,canvas.width+2,canvas.height+2);
		drawMap();
		pile.draw();
	}

	function movePieceHome(piece){
		let ix = Piece.all.indexOf(piece);
		let newspot;
		for(let i=0;i<6;i++){
			if(!Circle.all[i].piece){
				newspot = Circle.all[i];
				break;
			}
		}
		movePieceData(piece,newspot,true);
		return newspot;
	}

	function movePieceData(piece,newcircle,slide=false){
		piece.circle.piece = null;
		piece.circle = null;
		if(slide) piece.moveTo(newcircle);
		if(newcircle.piece){
			movePieceHome(newcircle.piece);
		}
		piece.circle = newcircle;
		newcircle.piece = piece;
	}

	let pile = new Button(574,215,63,111,onclick=>{
		let topcard = cards[0].ix;
		big_card = true;
		setTimeout(()=>{
			big_card = false;
		},5000);
	});

	function drawMap(){
		ctx.drawImage(MAP,0,0,canvas.width,canvas.height);
		let top = cards[0];
		for(let circle of Circle.all) circle.draw();
		for(let tree of Tree.all) tree.drawTree();
		if(MY_TURN && current_dice){
			let my_piece = Piece.all[turn.pix];
			highlightOpts(my_piece,current_dice.num);
		}
		let cur = Circle.getCurrent();
		if(cur && cur.isOpt){
			cur.draw('green');
			if(mouse.down){
				current_dice.hide();
				let path = cur.trace(current_dice.num);
				if(current_dice.num=='m'){
					for(let d of dice){
						if(!d.resist) d.hide();
						else {
							d.show();
						}
					}
				} else {
					var still_has_numbers = false;
					for(let d of dice){
						if(typeof d.num == 'number' && d.visible){
							still_has_numbers = true;
						} else if(!d.resist){
							d.hide();
						}
					}
					if(!still_has_numbers) dice[2].show();
				}
				current_dice = null;
				socket.emit('EF-turninfo','moveto '+path.map(e=>e.ix).join());
				for(let circle of Circle.all) circle.isOpt = false;
				Piece.all[turn.pix].walkPath(path).then(circle=>{
					let curpiece = Piece.all[turn.pix];
					movePieceData(curpiece,circle);
					let ix = tree_circles.indexOf(circle.ix);
					if(ix!=-1){
						Tree.all[ix].showHint().then(e=>{
							//after tree dissapears
						});
					}
					if(circle.ix == 123){
						keyLand();
					}
				});
				mouse.down = false;
			}
		} else if(cur){
			// CERTAIN CIRCLE DATA
		}
		if(!big_card){
			if(cards[0]) ctx.drawImage(cards[0].img,545,160,63,111);
		}
		for(let piece of Piece.all) piece.draw();
		if(big_clip) big_clip.drawTree();
		for(let die of dice) die.draw(die==current_dice?'green':'transparent');
		if(big_card){
			if(cards[0]) ctx.drawImage(cards[0].img,545-63/2,160-111/2,63*2,111*2);
		}
	}

	async function guessTree(){
		Tree.light = true;
		let p = new Promise((res,rej)=>{
			guesstreeprom = res;
		});
		let hint_ix = await p;
		guesstreeprom = null;
		Tree.light = false;
		return cards[0].ix == hint_ix;
	}

	async function keyLand(){
		let correct = await guessTree();
		for(let die of dice) if(!die.resist) {die.hide();} else {die.show()}
		if(correct){
			gotCard = true;
			socket.emit('EF-turninfo','popdeck');
			socket.emit('EF-sendpoints');
			cards.shift();
		} else {
			let pos = movePieceHome(Piece.all[turn.pix]);
			socket.emit('EF-turninfo','moveto '+pos.ix);
		}
	}

	function highlightOpts(piece,num){
		for(let circle of Circle.all){
			circle.isOpt = false;
		}
		if(num == 'm'){
			for(let t of tree_circles){
				let c = Circle.all[t];
				if(c.piece) continue;
				c.isOpt = true;
			}
			if(past_river.includes(piece.circle.ix)){
				Circle.all[123].isOpt = true; // KEY
			} else {
				Circle.all[98].isOpt = true; // Past Stone Bridge
			}
		} else {
			let opts = piece.circle.getCircles(num);
			for(let opt of opts){
				opt.isOpt = true;
			}
		}
	}

	class Piece extends Sprite{
		static all = [];
		constructor(color,ix){
			super(`assets/${color}.svg`);
			this.element.width = 60
			this.element.height = 100;
			this.circle = Circle.all[ix];
			this.position = new Vector(this.circle.pos.x,this.circle.pos.y-10);
			this.ix = ix;
			this.element.width *= .35;
			this.element.height *= .35;
			this.opts = [];
			Piece.all.push(this);
		}
		async moveTo(circle,speed=6){
			let pos = circle.pos;
			await this.slideTo(pos.x,pos.y-10,speed);
		}
		async walkPath(path,prev){
			if(path.length == 0) return prev;
			await this.moveTo(path[0]);
			let previ = path.shift();
			return await this.walkPath(path,previ);
		}
	}

	class Tree extends Button{
		static all = [];
		static set light(tf){
			for(let t of Tree.all) t.shiny = tf;
			show_hint = tf;
		}
		constructor(pos,ix){
			function onclick(){
				if(show_hint){
					socket.emit('EF-turninfo','guess '+this.ix);
					this.showHint();
					if(guesstreeprom){
						guesstreeprom(this.hint);
					}
				}
			}
			super(pos.x+17,pos.y+27,36,48,onclick,loadImage('assets/tree.png'));
			this.pos = pos;
			this.ix = ix;
			this.onclick = onclick;
			this.showing = false;
			Tree.all.push(this);
		}
		assignHint(ix,clip){
			this.hint = ix;
			this.clip = clip;
		}
		drawTree(){
			this.draw();
			if(this.showing && this.clip){
				ctx.drawImage(this.clip,canvas.width/2-100,canvas.height/2-100,200,200);
			}
		}
		set shiny(tf){
			this.img.src = tf?'assets/lighttree.png':'assets/tree.png';
		}
		async showHint(){
			let prom = new Promise((res,rej)=>{
				this.showing = true;
				big_clip = this;
				setTimeout(()=>{
					this.showing = false;
					big_clip = null;
					res();
				},5000);
			});
			return await prom;
		}
	}

	class Circle{
		static radius = 11;
		static all = [];
		static getCurrent = function(){
			return Circle.all.filter(e=>e.hasMouse())[0];
		}
		constructor(pos,ix){
			this.pos = pos;
			this.ix = ix;
			this.color = 'transparent';
			this.cons = [];
			Circle.all.push(this);
		}
		hasMouse(mousepos=mouse.pos){
			let dist = Vector.distance(this.pos.x,this.pos.y,mousepos.x,mousepos.y);
			return dist <= Circle.radius;
		}
		draw(color=this.isOpt?'yellow':this.color){
			// for(let con of this.cons){
			// 	ctx.beginPath();
			// 	ctx.strokeStyle = 'cyan';
			// 	ctx.lineWidth = 5;
			// 	ctx.moveTo(con.pos.x,con.pos.y);
			// 	ctx.lineTo(this.pos.x,this.pos.y);
			// 	ctx.stroke();
			// }
			ctx.beginPath();
			ctx.strokeStyle = color;
			ctx.lineWidth = this.isOpt?5:2;
			ctx.arc(this.pos.x,this.pos.y,Circle.radius,0,Math.PI*2);
			ctx.stroke();
		}
		addCon(circle){
			this.cons.push(circle);
			circle.cons.push(this);
		}
		getCircles(dist){
			var list = [];
			this.recur(dist,this,list);
			return list;
		}
		recur(dist,prev,list){
			this.temp_prev = prev;
			if(dist == 0){
				list.push(this);
				return;
			}
			for(let other of this.cons){
				if(other == prev) continue;
				other.recur(dist-1,this,list);
			}
		}
		trace(dist,result=[]){
			if(dist=='m') return [this];
			result.unshift(this);
			if(dist==0) return result;
			else return this.temp_prev.trace(dist-1,result);
		}
	}

	EF.start = loop;
	EF.setup = setup;
})(this);
